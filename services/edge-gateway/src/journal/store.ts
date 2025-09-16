import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import { createLogger } from '@ms5/shared/logger';
import path from 'path';

const logger = createLogger('journal-store');

export interface JournalEvent {
  id?: number;
  eventId: string;
  timestamp: Date;
  assetId: string;
  lineId?: string;
  type: string;
  data: Record<string, unknown>;
  signature?: string;
  previousSignature?: string;
  synced?: boolean;
  syncedAt?: Date;
  retryCount?: number;
  lastError?: string;
}

interface DatabaseRow {
  id: number;
  event_id: string;
  timestamp: string;
  asset_id: string;
  line_id: string | null;
  type: string;
  data: string;
  signature: string;
  previous_signature: string | null;
  synced: number;
  synced_at: string | null;
  retry_count: number;
  last_error: string | null;
}

interface CountResult {
  total: number;
  synced: number;
  pending: number;
}

interface SyncStatus {
  id: number;
  last_sync_id: number | null;
  last_sync_timestamp: string | null;
  total_synced: number;
  total_failed: number;
  updated_at: string;
}

export class JournalService {
  private db: Database.Database;
  private signingKey: string;

  constructor() {
    const dbPath = process.env.JOURNAL_DB_PATH || path.join(__dirname, '../../sqlite/journal.db');
    this.db = new Database(dbPath);
    this.signingKey = process.env.JOURNAL_SIGNING_KEY || 'dev-signing-key';
  }

  async initialize(): Promise<void> {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        timestamp DATETIME NOT NULL,
        asset_id TEXT NOT NULL,
        line_id TEXT,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        signature TEXT NOT NULL,
        previous_signature TEXT,
        synced BOOLEAN DEFAULT FALSE,
        synced_at DATETIME,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_synced ON events(synced);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_asset_id ON events(asset_id);

      CREATE TABLE IF NOT EXISTS sync_status (
        id INTEGER PRIMARY KEY,
        last_sync_id INTEGER,
        last_sync_timestamp DATETIME,
        total_synced INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clock_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_time DATETIME NOT NULL,
        server_time DATETIME,
        offset_ms INTEGER,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Initialize sync status if not exists
    const initStatus = this.db.prepare(`
      INSERT OR IGNORE INTO sync_status (id, last_sync_id) VALUES (1, 0)
    `);
    initStatus.run();

    // Set WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    logger.info('Journal store initialized');
  }

  async addEvent(event: Omit<JournalEvent, 'id' | 'signature' | 'previousSignature'>): Promise<number> {
    // Get previous signature
    const lastEvent = this.db.prepare(`
      SELECT signature FROM events ORDER BY id DESC LIMIT 1
    `).get() as { signature: string } | undefined;

    const previousSignature = lastEvent?.signature || null;

    // Calculate signature (hash chain)
    const signature = this.calculateSignature(event, previousSignature);

    // Insert event
    const stmt = this.db.prepare(`
      INSERT INTO events (
        event_id, timestamp, asset_id, line_id, type, data,
        signature, previous_signature, synced, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE, 0)
    `);

    const result = stmt.run(
      event.eventId,
      event.timestamp.toISOString(),
      event.assetId,
      event.lineId || null,
      event.type,
      JSON.stringify(event.data),
      signature,
      previousSignature,
    );

    logger.debug(
      { eventId: event.eventId, assetId: event.assetId },
      'Event added to journal',
    );

    return result.lastInsertRowid as number;
  }

  private calculateSignature(event: Omit<JournalEvent, 'id' | 'signature' | 'previousSignature' | 'synced' | 'syncedAt' | 'retryCount' | 'lastError'>, previousSignature: string | null): string {
    const data = {
      eventId: event.eventId,
      timestamp: event.timestamp,
      assetId: event.assetId,
      type: event.type,
      data: event.data,
      previousSignature,
    };

    const hash = crypto.createHmac('sha256', this.signingKey)
      .update(JSON.stringify(data))
      .digest('hex');

    return hash;
  }

  async getUnsyncedEvents(limit: number = 100): Promise<JournalEvent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE synced = FALSE AND retry_count < 5
      ORDER BY id ASC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as DatabaseRow[];

    return rows.map(row => ({
      id: row.id,
      eventId: row.event_id,
      timestamp: new Date(row.timestamp),
      assetId: row.asset_id,
      lineId: row.line_id,
      type: row.type,
      data: JSON.parse(row.data),
      signature: row.signature,
      previousSignature: row.previous_signature,
      synced: Boolean(row.synced),
      syncedAt: row.synced_at ? new Date(row.synced_at) : undefined,
      retryCount: row.retry_count,
      lastError: row.last_error,
    }));
  }

  async markSynced(eventIds: number[]): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE events
      SET synced = TRUE, synced_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const updateStatus = this.db.prepare(`
      UPDATE sync_status
      SET last_sync_id = ?, last_sync_timestamp = CURRENT_TIMESTAMP,
          total_synced = total_synced + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `);

    this.db.transaction(() => {
      for (const id of eventIds) {
        stmt.run(id);
      }
      const lastId = Math.max(...eventIds);
      updateStatus.run(lastId, eventIds.length);
    })();

    logger.info({ count: eventIds.length }, 'Events marked as synced');
  }

  async markFailed(eventId: number, error: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE events
      SET retry_count = retry_count + 1,
          last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(error, eventId);

    const updateStatus = this.db.prepare(`
      UPDATE sync_status
      SET total_failed = total_failed + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `);

    updateStatus.run();
  }

  async getEventCount(): Promise<{ total: number; synced: number; pending: number }> {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN synced = TRUE THEN 1 ELSE 0 END) as synced,
        SUM(CASE WHEN synced = FALSE THEN 1 ELSE 0 END) as pending
      FROM events
    `).get() as CountResult;

    return {
      total: result.total || 0,
      synced: result.synced || 0,
      pending: result.pending || 0,
    };
  }

  async getSyncStatus(): Promise<SyncStatus & CountResult> {
    const status = this.db.prepare(`
      SELECT * FROM sync_status WHERE id = 1
    `).get() as SyncStatus;

    const counts = await this.getEventCount();

    return {
      ...status,
      ...counts,
    };
  }

  async recordClockSync(localTime: Date, serverTime: Date): Promise<void> {
    const offsetMs = serverTime.getTime() - localTime.getTime();

    const stmt = this.db.prepare(`
      INSERT INTO clock_sync (local_time, server_time, offset_ms)
      VALUES (?, ?, ?)
    `);

    stmt.run(
      localTime.toISOString(),
      serverTime.toISOString(),
      offsetMs,
    );

    if (Math.abs(offsetMs) > 60000) { // More than 1 minute difference
      logger.warn({ offsetMs }, 'Significant clock drift detected');
    }
  }

  async getClockOffset(): Promise<number> {
    const result = this.db.prepare(`
      SELECT offset_ms FROM clock_sync
      ORDER BY id DESC LIMIT 1
    `).get() as { offset_ms: number } | undefined;

    return result?.offset_ms || 0;
  }

  async verifyIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const events = this.db.prepare(`
      SELECT id, event_id, timestamp, asset_id, type, data,
             signature, previous_signature
      FROM events
      ORDER BY id ASC
    `).all() as DatabaseRow[];

    let previousSignature: string | null = null;

    for (const event of events) {
      const expectedSignature = this.calculateSignature(
        {
          eventId: event.event_id,
          timestamp: event.timestamp,
          assetId: event.asset_id,
          type: event.type,
          data: JSON.parse(event.data),
        },
        previousSignature,
      );

      if (expectedSignature !== event.signature) {
        errors.push(`Event ${event.id} has invalid signature`);
      }

      if (previousSignature !== event.previous_signature) {
        errors.push(`Event ${event.id} has broken chain`);
      }

      previousSignature = event.signature;
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async pruneOldEvents(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const stmt = this.db.prepare(`
      DELETE FROM events
      WHERE synced = TRUE AND timestamp < ?
    `);

    const result = stmt.run(cutoffDate.toISOString());

    logger.info({ deleted: result.changes }, 'Old events pruned');

    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
    logger.info('Journal store closed');
  }
}