import DataLoader from 'dataloader';
import { PrismaClient } from '@prisma/client';
import { poolManager } from '@ms5/shared/database/pool';
import { QueryCache } from '@ms5/shared/cache/query-cache';
import { createLogger } from '@ms5/shared/logger';

const logger = createLogger('dataloaders');
const prisma = new PrismaClient();
const cache = new QueryCache({ defaultTTL: 60 }); // 1 minute cache

// Types for our data models
interface BatchLoadResult<T> {
  id: string;
  data: T | null;
}

// Generic batch loading function with error handling
async function batchLoad<T>(
  ids: readonly string[],
  loader: (ids: string[]) => Promise<Map<string, T>>
): Promise<(T | null)[]> {
  try {
    const results = await loader([...ids]);
    return ids.map(id => results.get(id) || null);
  } catch (error) {
    logger.error({ error, ids }, 'Batch loading error');
    return ids.map(() => null);
  }
}

// User DataLoader
export function createUserLoader() {
  return new DataLoader<string, any>(async (userIds) => {
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } }
    });

    const userMap = new Map(users.map(user => [user.id, user]));
    return userIds.map(id => userMap.get(id) || null);
  }, {
    maxBatchSize: 100,
    cache: true,
    cacheKeyFn: (key) => `user:${key}`
  });
}

// Production Line DataLoader
export function createLineLoader() {
  return new DataLoader<string, any>(async (lineIds) => {
    const query = `
      SELECT l.*,
             COUNT(DISTINCT a.id) as asset_count,
             COUNT(DISTINCT ac.id) FILTER (WHERE ac.status = 'TRIGGERED') as active_andon_count
      FROM production_lines l
      LEFT JOIN assets a ON a.line_id = l.id
      LEFT JOIN andon_calls ac ON ac.line_id = l.id AND ac.status IN ('TRIGGERED', 'ACKNOWLEDGED')
      WHERE l.id = ANY($1)
      GROUP BY l.id
    `;

    const pool = poolManager.getReadPool();
    const result = await pool.query(query, [[...lineIds]]);

    const lineMap = new Map(result.rows.map(line => [line.id, line]));
    return lineIds.map(id => lineMap.get(id) || null);
  }, {
    maxBatchSize: 50,
    cache: true
  });
}

// Asset DataLoader
export function createAssetLoader() {
  return new DataLoader<string, any>(async (assetIds) => {
    const query = `
      SELECT a.*,
             l.name as line_name,
             l.area_id,
             COALESCE(
               (SELECT oee FROM oee_metrics
                WHERE asset_id = a.id
                ORDER BY timestamp DESC LIMIT 1),
               0
             ) as current_oee
      FROM assets a
      LEFT JOIN production_lines l ON l.id = a.line_id
      WHERE a.id = ANY($1)
    `;

    const pool = poolManager.getReadPool();
    const result = await pool.query(query, [[...assetIds]]);

    const assetMap = new Map(result.rows.map(asset => [asset.id, asset]));
    return assetIds.map(id => assetMap.get(id) || null);
  }, {
    maxBatchSize: 100,
    cache: true
  });
}

// SQDC Action DataLoader
export function createActionLoader() {
  return new DataLoader<string, any>(async (actionIds) => {
    const actions = await prisma.sQDCAction.findMany({
      where: { id: { in: [...actionIds] } },
      include: {
        assignedUser: true,
        createdBy: true,
        tierBoard: true
      }
    });

    const actionMap = new Map(actions.map(action => [action.id, action]));
    return actionIds.map(id => actionMap.get(id) || null);
  }, {
    maxBatchSize: 100,
    cache: true
  });
}

// Tier Board DataLoader
export function createTierBoardLoader() {
  return new DataLoader<string, any>(async (boardIds) => {
    const boards = await prisma.tierBoard.findMany({
      where: { id: { in: [...boardIds] } },
      include: {
        line: true,
        actions: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    const boardMap = new Map(boards.map(board => [board.id, board]));
    return boardIds.map(id => boardMap.get(id) || null);
  }, {
    maxBatchSize: 50,
    cache: true
  });
}

// OEE Metrics DataLoader (with caching)
export function createOEELoader() {
  return new DataLoader<string, any>(async (keys) => {
    // Keys are in format: "assetId:startTime:endTime"
    const queries = keys.map(key => {
      const [assetId, startTime, endTime] = key.split(':');
      return { assetId, startTime, endTime };
    });

    const results = await Promise.all(
      queries.map(async ({ assetId, startTime, endTime }) => {
        const cacheKey = `oee:${assetId}:${startTime}:${endTime}`;

        // Try cache first
        const cached = await cache.get(cacheKey, []);
        if (cached) {
          return { key: `${assetId}:${startTime}:${endTime}`, data: cached };
        }

        // Query database
        const query = `
          SELECT
            asset_id,
            AVG(availability) as availability,
            AVG(performance) as performance,
            AVG(quality) as quality,
            AVG(oee) as oee,
            SUM(runtime) as runtime,
            SUM(planned_time) as planned_time,
            SUM(total_count) as total_count,
            SUM(good_count) as good_count,
            SUM(defect_count) as defect_count
          FROM oee_metrics
          WHERE asset_id = $1
            AND timestamp >= $2
            AND timestamp <= $3
          GROUP BY asset_id
        `;

        const pool = poolManager.getReadPool();
        const result = await pool.query(query, [assetId, startTime, endTime]);

        const data = result.rows[0] || null;

        // Cache the result
        if (data) {
          await cache.set(cacheKey, [], data, { ttl: 300 }); // 5 minutes
        }

        return { key: `${assetId}:${startTime}:${endTime}`, data };
      })
    );

    const resultMap = new Map(results.map(r => [r.key, r.data]));
    return keys.map(key => resultMap.get(key) || null);
  }, {
    maxBatchSize: 20,
    cache: false // We handle caching manually
  });
}

// Loss Events DataLoader
export function createLossEventLoader() {
  return new DataLoader<string, any[]>(async (keys) => {
    // Keys are in format: "assetId:limit"
    const queries = keys.map(key => {
      const [assetId, limit = '100'] = key.split(':');
      return { assetId, limit: parseInt(limit) };
    });

    const results = await Promise.all(
      queries.map(async ({ assetId, limit }) => {
        const query = `
          SELECT *
          FROM loss_events
          WHERE asset_id = $1
          ORDER BY start_time DESC
          LIMIT $2
        `;

        const pool = poolManager.getReadPool();
        const result = await pool.query(query, [assetId, limit]);

        return {
          key: `${assetId}:${limit}`,
          data: result.rows
        };
      })
    );

    const resultMap = new Map(results.map(r => [r.key, r.data]));
    return keys.map(key => resultMap.get(key) || []);
  }, {
    maxBatchSize: 10,
    cache: true
  });
}

// Andon Calls DataLoader
export function createAndonLoader() {
  return new DataLoader<string, any>(async (callIds) => {
    const query = `
      SELECT ac.*,
             u1.name as triggered_by_name,
             u2.name as acknowledged_by_name,
             u3.name as resolved_by_name,
             l.name as line_name,
             s.name as station_name
      FROM andon_calls ac
      LEFT JOIN users u1 ON u1.id = ac.triggered_by
      LEFT JOIN users u2 ON u2.id = ac.acknowledged_by
      LEFT JOIN users u3 ON u3.id = ac.resolved_by
      LEFT JOIN production_lines l ON l.id = ac.line_id
      LEFT JOIN stations s ON s.id = ac.station_id
      WHERE ac.id = ANY($1)
    `;

    const pool = poolManager.getReadPool();
    const result = await pool.query(query, [[...callIds]]);

    const callMap = new Map(result.rows.map(call => [call.id, call]));
    return callIds.map(id => callMap.get(id) || null);
  }, {
    maxBatchSize: 100,
    cache: true
  });
}

// Telemetry DataLoader (for recent telemetry data)
export function createTelemetryLoader() {
  return new DataLoader<string, any[]>(async (keys) => {
    // Keys are in format: "assetId:minutes"
    const queries = keys.map(key => {
      const [assetId, minutes = '60'] = key.split(':');
      return { assetId, minutes: parseInt(minutes) };
    });

    const results = await Promise.all(
      queries.map(async ({ assetId, minutes }) => {
        const cacheKey = `telemetry:${assetId}:${minutes}`;

        // Try cache for recent data
        const cached = await cache.get(cacheKey, []);
        if (cached) {
          return { key: `${assetId}:${minutes}`, data: cached };
        }

        const query = `
          SELECT time_bucket('1 minute', timestamp) as bucket,
                 asset_id,
                 AVG(temperature) as avg_temperature,
                 AVG(pressure) as avg_pressure,
                 AVG(vibration) as avg_vibration,
                 AVG(speed) as avg_speed,
                 COUNT(*) as data_points
          FROM telemetry
          WHERE asset_id = $1
            AND timestamp > NOW() - INTERVAL '${minutes} minutes'
          GROUP BY bucket, asset_id
          ORDER BY bucket DESC
        `;

        const pool = poolManager.getReadPool();
        const result = await pool.query(query, [assetId]);

        // Cache for short period
        await cache.set(cacheKey, [], result.rows, { ttl: 60 });

        return {
          key: `${assetId}:${minutes}`,
          data: result.rows
        };
      })
    );

    const resultMap = new Map(results.map(r => [r.key, r.data]));
    return keys.map(key => resultMap.get(key) || []);
  }, {
    maxBatchSize: 10,
    cache: false // We handle caching manually
  });
}

// Create all dataloaders for a request context
export interface DataLoaders {
  userLoader: DataLoader<string, any>;
  lineLoader: DataLoader<string, any>;
  assetLoader: DataLoader<string, any>;
  actionLoader: DataLoader<string, any>;
  tierBoardLoader: DataLoader<string, any>;
  oeeLoader: DataLoader<string, any>;
  lossEventLoader: DataLoader<string, any[]>;
  andonLoader: DataLoader<string, any>;
  telemetryLoader: DataLoader<string, any[]>;
}

export function createDataLoaders(): DataLoaders {
  return {
    userLoader: createUserLoader(),
    lineLoader: createLineLoader(),
    assetLoader: createAssetLoader(),
    actionLoader: createActionLoader(),
    tierBoardLoader: createTierBoardLoader(),
    oeeLoader: createOEELoader(),
    lossEventLoader: createLossEventLoader(),
    andonLoader: createAndonLoader(),
    telemetryLoader: createTelemetryLoader()
  };
}

// Helper function to clear all loader caches
export function clearLoaderCaches(loaders: DataLoaders): void {
  Object.values(loaders).forEach(loader => {
    if (loader && typeof loader.clearAll === 'function') {
      loader.clearAll();
    }
  });
}

// Helper to prime loader caches with known data
export function primeLoaderCache<K, V>(
  loader: DataLoader<K, V>,
  key: K,
  value: V
): void {
  loader.clear(key).prime(key, value);
}

// Monitoring helper for loader performance
export function getLoaderStats(loaders: DataLoaders): Record<string, any> {
  const stats: Record<string, any> = {};

  Object.entries(loaders).forEach(([name, loader]) => {
    if (loader) {
      // DataLoader doesn't expose internal stats, so we track manually
      stats[name] = {
        name,
        cacheEnabled: true,
        // Additional stats would need custom tracking
      };
    }
  });

  return stats;
}