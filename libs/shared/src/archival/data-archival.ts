import { Pool } from 'pg';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createLogger } from '../logger';
import { Readable } from 'stream';
import zlib from 'zlib';
import { promisify } from 'util';
import path from 'path';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const logger = createLogger('data-archival');

export interface ArchivalConfig {
  retentionDays: {
    hot: number;    // Data in primary database
    warm: number;   // Data in compressed storage
    cold: number;   // Data in archive storage
  };
  batchSize?: number;
  compressionLevel?: number;
  s3Config?: {
    bucket: string;
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  schedule?: string;
}

export interface ArchivalJob {
  id: string;
  table: string;
  startDate: Date;
  endDate: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  recordsArchived?: number;
  sizeBytes?: number;
  compressionRatio?: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export class DataArchival {
  private pool: Pool;
  private s3Client?: S3Client;
  private jobs = new Map<string, ArchivalJob>();
  private config: Required<ArchivalConfig>;

  constructor(
    pool: Pool,
    config: ArchivalConfig
  ) {
    this.pool = pool;
    this.config = {
      retentionDays: config.retentionDays,
      batchSize: config.batchSize || 10000,
      compressionLevel: config.compressionLevel || 6,
      s3Config: config.s3Config,
      schedule: config.schedule || '0 2 * * *' // 2 AM daily
    } as Required<ArchivalConfig>;

    if (config.s3Config) {
      this.s3Client = new S3Client({
        region: config.s3Config.region,
        credentials: config.s3Config.accessKeyId ? {
          accessKeyId: config.s3Config.accessKeyId,
          secretAccessKey: config.s3Config.secretAccessKey!
        } : undefined
      });
    }
  }

  async archiveTable(
    tableName: string,
    options: {
      dateColumn?: string;
      partitionColumn?: string;
      whereClause?: string;
    } = {}
  ): Promise<ArchivalJob> {
    const jobId = `${tableName}_${Date.now()}`;
    const dateColumn = options.dateColumn || 'created_at';
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays.hot);

    const job: ArchivalJob = {
      id: jobId,
      table: tableName,
      startDate: new Date(0),
      endDate: cutoffDate,
      status: 'pending'
    };

    this.jobs.set(jobId, job);

    try {
      job.status = 'running';
      job.startedAt = new Date();

      // Step 1: Export data to compressed format
      const exportResult = await this.exportData(tableName, {
        dateColumn,
        cutoffDate,
        whereClause: options.whereClause
      });

      // Step 2: Upload to S3
      if (this.s3Client && this.config.s3Config) {
        await this.uploadToS3(exportResult.data, {
          bucket: this.config.s3Config.bucket,
          key: `archives/${tableName}/${jobId}.json.gz`
        });
      }

      // Step 3: Create archive metadata
      await this.createArchiveMetadata({
        jobId,
        tableName,
        recordCount: exportResult.recordCount,
        sizeBytes: exportResult.sizeBytes,
        compressionRatio: exportResult.compressionRatio,
        dateRange: {
          start: exportResult.minDate,
          end: exportResult.maxDate
        }
      });

      // Step 4: Delete archived data from hot storage
      const deletedCount = await this.deleteArchivedData(tableName, {
        dateColumn,
        cutoffDate,
        whereClause: options.whereClause
      });

      job.status = 'completed';
      job.completedAt = new Date();
      job.recordsArchived = deletedCount;
      job.sizeBytes = exportResult.sizeBytes;
      job.compressionRatio = exportResult.compressionRatio;

      logger.info({
        jobId,
        table: tableName,
        recordsArchived: deletedCount,
        sizeBytes: exportResult.sizeBytes,
        duration: job.completedAt.getTime() - job.startedAt!.getTime()
      }, 'Archive job completed');

      return job;
    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      logger.error({ error, jobId }, 'Archive job failed');
      throw error;
    }
  }

  private async exportData(
    tableName: string,
    options: {
      dateColumn: string;
      cutoffDate: Date;
      whereClause?: string;
    }
  ): Promise<{
    data: Buffer;
    recordCount: number;
    sizeBytes: number;
    compressionRatio: number;
    minDate: Date;
    maxDate: Date;
  }> {
    const whereClause = options.whereClause 
      ? `${options.whereClause} AND ${options.dateColumn} < $1`
      : `${options.dateColumn} < $1`;

    const query = `
      SELECT *
      FROM ${tableName}
      WHERE ${whereClause}
      ORDER BY ${options.dateColumn}
    `;

    const result = await this.pool.query(query, [options.cutoffDate]);
    const jsonData = JSON.stringify(result.rows);
    const compressed = await gzip(jsonData, {
      level: this.config.compressionLevel
    });

    // Get date range
    const dates = result.rows.map(row => new Date(row[options.dateColumn]));
    const minDate = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date(0);
    const maxDate = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : options.cutoffDate;

    return {
      data: compressed,
      recordCount: result.rows.length,
      sizeBytes: compressed.length,
      compressionRatio: jsonData.length / compressed.length,
      minDate,
      maxDate
    };
  }

  private async uploadToS3(
    data: Buffer,
    options: {
      bucket: string;
      key: string;
    }
  ): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not configured');
    }

    const command = new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Body: data,
      ContentType: 'application/gzip',
      ContentEncoding: 'gzip',
      Metadata: {
        archivalDate: new Date().toISOString(),
        compressionLevel: String(this.config.compressionLevel)
      }
    });

    await this.s3Client.send(command);
    
    logger.info({
      bucket: options.bucket,
      key: options.key,
      size: data.length
    }, 'Data uploaded to S3');
  }

  private async createArchiveMetadata(
    metadata: {
      jobId: string;
      tableName: string;
      recordCount: number;
      sizeBytes: number;
      compressionRatio: number;
      dateRange: { start: Date; end: Date };
    }
  ): Promise<void> {
    const query = `
      INSERT INTO archive_metadata (
        job_id, table_name, record_count, size_bytes,
        compression_ratio, date_range_start, date_range_end,
        archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `;

    await this.pool.query(query, [
      metadata.jobId,
      metadata.tableName,
      metadata.recordCount,
      metadata.sizeBytes,
      metadata.compressionRatio,
      metadata.dateRange.start,
      metadata.dateRange.end
    ]);
  }

  private async deleteArchivedData(
    tableName: string,
    options: {
      dateColumn: string;
      cutoffDate: Date;
      whereClause?: string;
    }
  ): Promise<number> {
    const whereClause = options.whereClause 
      ? `${options.whereClause} AND ${options.dateColumn} < $1`
      : `${options.dateColumn} < $1`;

    const query = `
      DELETE FROM ${tableName}
      WHERE ${whereClause}
    `;

    const result = await this.pool.query(query, [options.cutoffDate]);
    return result.rowCount;
  }

  async restoreFromArchive(
    jobId: string,
    options: {
      targetTable?: string;
      dateFilter?: { start: Date; end: Date };
    } = {}
  ): Promise<number> {
    // Get archive metadata
    const metadataQuery = `
      SELECT * FROM archive_metadata WHERE job_id = $1
    `;
    const metadataResult = await this.pool.query(metadataQuery, [jobId]);
    
    if (metadataResult.rows.length === 0) {
      throw new Error(`Archive job ${jobId} not found`);
    }

    const metadata = metadataResult.rows[0];
    const targetTable = options.targetTable || metadata.table_name;

    // Download from S3
    if (this.s3Client && this.config.s3Config) {
      const key = `archives/${metadata.table_name}/${jobId}.json.gz`;
      const command = new GetObjectCommand({
        Bucket: this.config.s3Config.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      const compressed = await this.streamToBuffer(response.Body as Readable);
      const decompressed = await gunzip(compressed);
      const data = JSON.parse(decompressed.toString());

      // Apply date filter if specified
      let filteredData = data;
      if (options.dateFilter) {
        filteredData = data.filter((row: any) => {
          const date = new Date(row.created_at);
          return date >= options.dateFilter!.start && date <= options.dateFilter!.end;
        });
      }

      // Insert data back to database
      if (filteredData.length > 0) {
        await this.batchInsert(targetTable, filteredData);
      }

      logger.info({
        jobId,
        recordsRestored: filteredData.length,
        targetTable
      }, 'Data restored from archive');

      return filteredData.length;
    }

    throw new Error('S3 client not configured');
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  private async batchInsert(
    tableName: string,
    data: any[],
  ): Promise<void> {
    const batchSize = this.config.batchSize;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      if (batch.length === 0) continue;

      // Get column names from first record
      const columns = Object.keys(batch[0]);
      const values: any[] = [];
      const placeholders: string[] = [];
      
      batch.forEach((record, index) => {
        const rowPlaceholders = columns.map((_, colIndex) => 
          `$${index * columns.length + colIndex + 1}`
        ).join(', ');
        placeholders.push(`(${rowPlaceholders})`);
        
        columns.forEach(col => values.push(record[col]));
      });

      const query = `
        INSERT INTO ${tableName} (${columns.join(', ')})
        VALUES ${placeholders.join(', ')}
        ON CONFLICT DO NOTHING
      `;

      await this.pool.query(query, values);
    }
  }

  async getArchiveStats(): Promise<{
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    totalRecordsArchived: number;
    totalSizeBytes: number;
    averageCompressionRatio: number;
  }> {
    const query = `
      SELECT
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
        SUM(record_count) as total_records,
        SUM(size_bytes) as total_bytes,
        AVG(compression_ratio) as avg_compression
      FROM archive_metadata
    `;

    const result = await this.pool.query(query);
    const stats = result.rows[0];

    return {
      totalJobs: parseInt(stats.total_jobs),
      completedJobs: parseInt(stats.completed_jobs),
      failedJobs: parseInt(stats.failed_jobs),
      totalRecordsArchived: parseInt(stats.total_records || 0),
      totalSizeBytes: parseInt(stats.total_bytes || 0),
      averageCompressionRatio: parseFloat(stats.avg_compression || 0)
    };
  }

  async scheduleArchival(
    tables: Array<{
      name: string;
      dateColumn?: string;
      whereClause?: string;
    }>
  ): Promise<void> {
    // This would integrate with a job scheduler like node-cron
    logger.info({ tables: tables.length }, 'Archival scheduled for tables');
    
    for (const table of tables) {
      try {
        await this.archiveTable(table.name, {
          dateColumn: table.dateColumn,
          whereClause: table.whereClause
        });
      } catch (error) {
        logger.error({ error, table: table.name }, 'Failed to archive table');
      }
    }
  }

  getJob(jobId: string): ArchivalJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): ArchivalJob[] {
    return Array.from(this.jobs.values());
  }
}

// Specialized archival strategies
export class TelemetryArchival extends DataArchival {
  constructor(pool: Pool) {
    super(pool, {
      retentionDays: {
        hot: 7,    // 1 week in primary
        warm: 30,  // 1 month in compressed
        cold: 365  // 1 year in archive
      },
      batchSize: 50000,
      compressionLevel: 9,
      s3Config: {
        bucket: process.env.ARCHIVE_BUCKET || 'ms5-archives',
        region: process.env.AWS_REGION || 'us-east-1'
      }
    });
  }

  async archiveTelemetry(): Promise<void> {
    await this.archiveTable('telemetry', {
      dateColumn: 'timestamp',
      partitionColumn: 'asset_id'
    });
  }
}

export class EventArchival extends DataArchival {
  constructor(pool: Pool) {
    super(pool, {
      retentionDays: {
        hot: 30,   // 1 month in primary
        warm: 90,  // 3 months in compressed
        cold: 730  // 2 years in archive
      },
      batchSize: 10000,
      compressionLevel: 6
    });
  }

  async archiveEvents(): Promise<void> {
    await this.archiveTable('events', {
      dateColumn: 'created_at'
    });
  }
}

export class AuditLogArchival extends DataArchival {
  constructor(pool: Pool) {
    super(pool, {
      retentionDays: {
        hot: 90,    // 3 months in primary
        warm: 365,  // 1 year in compressed
        cold: 2555  // 7 years in archive (compliance)
      },
      batchSize: 5000,
      compressionLevel: 9
    });
  }

  async archiveAuditLogs(): Promise<void> {
    await this.archiveTable('audit_logs', {
      dateColumn: 'timestamp',
      whereClause: 'action_type NOT IN (\'security\', \'compliance\')' // Keep security logs longer
    });
  }
}