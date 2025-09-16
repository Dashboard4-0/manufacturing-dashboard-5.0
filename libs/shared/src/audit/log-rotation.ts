import { createWriteStream, promises as fs, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGzip, createGunzip } from 'zlib';
import path from 'path';
import { createLogger } from '../logger';
import crypto from 'crypto';
import { promisify } from 'util';

const logger = createLogger('log-rotation');

export interface RotationConfig {
  maxFileSize?: number;
  maxFiles?: number;
  maxAge?: number;
  compress?: boolean;
  datePattern?: string;
  auditLogPath?: string;
  archivePath?: string;
  hashVerification?: boolean;
}

export interface LogFile {
  name: string;
  path: string;
  size: number;
  created: Date;
  modified: Date;
  compressed: boolean;
  hash?: string;
}

export class AuditLogRotator {
  private config: Required<RotationConfig>;
  private currentFile?: string;
  private currentStream?: NodeJS.WritableStream;
  private currentSize = 0;
  private rotationTimer?: NodeJS.Timer;
  private hashChain: string[] = [];

  constructor(config: RotationConfig = {}) {
    this.config = {
      maxFileSize: config.maxFileSize || 100 * 1024 * 1024, // 100MB
      maxFiles: config.maxFiles || 10,
      maxAge: config.maxAge || 90 * 24 * 60 * 60 * 1000, // 90 days
      compress: config.compress ?? true,
      datePattern: config.datePattern || 'YYYY-MM-DD',
      auditLogPath: config.auditLogPath || './logs/audit',
      archivePath: config.archivePath || './logs/archive',
      hashVerification: config.hashVerification ?? true
    };

    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Create directories if they don't exist
    await fs.mkdir(this.config.auditLogPath, { recursive: true });
    await fs.mkdir(this.config.archivePath, { recursive: true });

    // Start rotation check timer
    this.startRotationTimer();

    // Load existing hash chain
    await this.loadHashChain();

    // Initialize current file
    await this.initCurrentFile();
  }

  private startRotationTimer(): void {
    // Check every hour if rotation is needed
    this.rotationTimer = setInterval(async () => {
      await this.checkRotation();
    }, 60 * 60 * 1000);
  }

  private async initCurrentFile(): Promise<void> {
    const fileName = this.generateFileName();
    this.currentFile = path.join(this.config.auditLogPath, fileName);

    // Check if file exists and get its size
    try {
      const stats = await fs.stat(this.currentFile);
      this.currentSize = stats.size;
    } catch {
      this.currentSize = 0;
    }

    // Open stream for appending
    this.currentStream = createWriteStream(this.currentFile, {
      flags: 'a',
      encoding: 'utf8'
    });
  }

  private generateFileName(): string {
    const date = new Date();
    const dateStr = this.formatDate(date, this.config.datePattern);
    return `audit-${dateStr}.log`;
  }

  private formatDate(date: Date, pattern: string): string {
    return pattern
      .replace('YYYY', date.getFullYear().toString())
      .replace('MM', String(date.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(date.getDate()).padStart(2, '0'))
      .replace('HH', String(date.getHours()).padStart(2, '0'))
      .replace('mm', String(date.getMinutes()).padStart(2, '0'))
      .replace('ss', String(date.getSeconds()).padStart(2, '0'));
  }

  async write(entry: any): Promise<void> {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      ...entry,
      hash: this.config.hashVerification ? this.calculateHash(entry) : undefined
    };

    const line = JSON.stringify(logEntry) + '\n';
    const size = Buffer.byteLength(line);

    // Check if rotation is needed
    if (this.currentSize + size > this.config.maxFileSize) {
      await this.rotate();
    }

    // Write to current file
    await new Promise<void>((resolve, reject) => {
      this.currentStream!.write(line, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    this.currentSize += size;

    // Update hash chain
    if (this.config.hashVerification) {
      this.updateHashChain(logEntry);
    }
  }

  private calculateHash(entry: any): string {
    const content = JSON.stringify(entry);
    const previousHash = this.hashChain[this.hashChain.length - 1] || '0';
    return crypto
      .createHash('sha256')
      .update(previousHash + content)
      .digest('hex');
  }

  private updateHashChain(entry: any): void {
    const hash = this.calculateHash(entry);
    this.hashChain.push(hash);

    // Keep only last 1000 hashes in memory
    if (this.hashChain.length > 1000) {
      this.hashChain = this.hashChain.slice(-1000);
    }
  }

  private async loadHashChain(): Promise<void> {
    try {
      const hashFile = path.join(this.config.auditLogPath, '.hashchain');
      const data = await fs.readFile(hashFile, 'utf8');
      this.hashChain = JSON.parse(data);
    } catch {
      this.hashChain = [];
    }
  }

  private async saveHashChain(): Promise<void> {
    const hashFile = path.join(this.config.auditLogPath, '.hashchain');
    await fs.writeFile(hashFile, JSON.stringify(this.hashChain));
  }

  async rotate(): Promise<void> {
    logger.info({ currentFile: this.currentFile }, 'Rotating audit log');

    // Close current stream
    if (this.currentStream) {
      await new Promise<void>((resolve) => {
        this.currentStream!.end(() => resolve());
      });
    }

    // Save hash chain
    await this.saveHashChain();

    // Compress current file if configured
    if (this.config.compress && this.currentFile) {
      await this.compressFile(this.currentFile);
    }

    // Move to archive
    if (this.currentFile) {
      const archiveName = path.basename(this.currentFile);
      const archivePath = path.join(
        this.config.archivePath,
        this.config.compress ? archiveName + '.gz' : archiveName
      );
      
      if (this.config.compress) {
        // File is already compressed, just verify it exists
        const compressedPath = this.currentFile + '.gz';
        await fs.rename(compressedPath, archivePath);
      } else {
        await fs.rename(this.currentFile, archivePath);
      }
    }

    // Clean up old files
    await this.cleanOldFiles();

    // Initialize new file
    await this.initCurrentFile();
  }

  private async compressFile(filePath: string): Promise<void> {
    const input = createReadStream(filePath);
    const output = createWriteStream(filePath + '.gz');
    const gzip = createGzip({ level: 9 });

    await pipeline(input, gzip, output);
    await fs.unlink(filePath); // Remove original file

    logger.info({ file: filePath }, 'Audit log compressed');
  }

  private async cleanOldFiles(): Promise<void> {
    const files = await this.listLogFiles();
    const now = Date.now();

    // Sort by modified date
    files.sort((a, b) => b.modified.getTime() - a.modified.getTime());

    // Remove files exceeding max count
    const filesToRemove = files.slice(this.config.maxFiles);

    // Also remove files exceeding max age
    for (const file of files) {
      const age = now - file.modified.getTime();
      if (age > this.config.maxAge) {
        filesToRemove.push(file);
      }
    }

    // Remove duplicates and delete files
    const uniqueFiles = Array.from(new Set(filesToRemove.map(f => f.path)));
    for (const filePath of uniqueFiles) {
      await fs.unlink(filePath);
      logger.info({ file: filePath }, 'Old audit log removed');
    }
  }

  private async listLogFiles(): Promise<LogFile[]> {
    const archiveFiles = await fs.readdir(this.config.archivePath);
    const files: LogFile[] = [];

    for (const fileName of archiveFiles) {
      if (!fileName.startsWith('audit-')) continue;

      const filePath = path.join(this.config.archivePath, fileName);
      const stats = await fs.stat(filePath);

      files.push({
        name: fileName,
        path: filePath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        compressed: fileName.endsWith('.gz')
      });
    }

    return files;
  }

  async checkRotation(): Promise<void> {
    // Check if current file needs rotation
    if (this.currentSize > this.config.maxFileSize) {
      await this.rotate();
      return;
    }

    // Check if date has changed (daily rotation)
    const currentFileName = this.generateFileName();
    const expectedPath = path.join(this.config.auditLogPath, currentFileName);
    
    if (this.currentFile !== expectedPath) {
      await this.rotate();
    }
  }

  async verifyIntegrity(
    filePath: string,
    options: { decompress?: boolean } = {}
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    let content: string;

    // Read file content
    if (options.decompress && filePath.endsWith('.gz')) {
      const input = createReadStream(filePath);
      const gunzip = createGunzip();
      const chunks: Buffer[] = [];
      
      await pipeline(
        input,
        gunzip,
        async function* (source) {
          for await (const chunk of source) {
            chunks.push(chunk);
          }
        }
      );
      
      content = Buffer.concat(chunks).toString('utf8');
    } else {
      content = await fs.readFile(filePath, 'utf8');
    }

    // Parse and verify each line
    const lines = content.trim().split('\n');
    let previousHash = '0';

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        
        if (this.config.hashVerification && entry.hash) {
          // Recalculate hash
          const entryWithoutHash = { ...entry };
          delete entryWithoutHash.hash;
          
          const expectedHash = crypto
            .createHash('sha256')
            .update(previousHash + JSON.stringify(entryWithoutHash))
            .digest('hex');

          if (entry.hash !== expectedHash) {
            errors.push(`Line ${i + 1}: Hash mismatch`);
          }

          previousHash = entry.hash;
        }
      } catch (error) {
        errors.push(`Line ${i + 1}: Invalid JSON`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async search(
    criteria: {
      startDate?: Date;
      endDate?: Date;
      userId?: string;
      action?: string;
      resource?: string;
    },
    options: { limit?: number } = {}
  ): Promise<any[]> {
    const results: any[] = [];
    const files = await this.listLogFiles();
    const limit = options.limit || 1000;

    // Filter files by date range
    const relevantFiles = files.filter(file => {
      if (criteria.startDate && file.modified < criteria.startDate) {
        return false;
      }
      if (criteria.endDate && file.created > criteria.endDate) {
        return false;
      }
      return true;
    });

    // Search through files
    for (const file of relevantFiles) {
      if (results.length >= limit) break;

      let content: string;
      if (file.compressed) {
        // Decompress and read
        const input = createReadStream(file.path);
        const gunzip = createGunzip();
        const chunks: Buffer[] = [];
        
        await pipeline(
          input,
          gunzip,
          async function* (source) {
            for await (const chunk of source) {
              chunks.push(chunk);
            }
          }
        );
        
        content = Buffer.concat(chunks).toString('utf8');
      } else {
        content = await fs.readFile(file.path, 'utf8');
      }

      // Parse and filter entries
      const lines = content.trim().split('\n');
      for (const line of lines) {
        if (results.length >= limit) break;

        try {
          const entry = JSON.parse(line);
          
          // Apply filters
          if (criteria.startDate && new Date(entry.timestamp) < criteria.startDate) continue;
          if (criteria.endDate && new Date(entry.timestamp) > criteria.endDate) continue;
          if (criteria.userId && entry.userId !== criteria.userId) continue;
          if (criteria.action && entry.action !== criteria.action) continue;
          if (criteria.resource && entry.resource !== criteria.resource) continue;

          results.push(entry);
        } catch {
          // Skip invalid lines
        }
      }
    }

    return results;
  }

  async getStats(): Promise<{
    currentFile: string;
    currentSize: number;
    totalFiles: number;
    totalSize: number;
    oldestFile?: Date;
    newestFile?: Date;
  }> {
    const files = await this.listLogFiles();
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const dates = files.map(f => f.created).sort((a, b) => a.getTime() - b.getTime());

    return {
      currentFile: this.currentFile || '',
      currentSize: this.currentSize,
      totalFiles: files.length,
      totalSize: totalSize + this.currentSize,
      oldestFile: dates[0],
      newestFile: dates[dates.length - 1]
    };
  }

  async close(): Promise<void> {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }

    if (this.currentStream) {
      await new Promise<void>((resolve) => {
        this.currentStream!.end(() => resolve());
      });
    }

    await this.saveHashChain();
    logger.info('Audit log rotator closed');
  }
}

// Singleton instance
let rotator: AuditLogRotator | null = null;

export function initializeLogRotator(config?: RotationConfig): AuditLogRotator {
  if (!rotator) {
    rotator = new AuditLogRotator(config);
  }
  return rotator;
}

export function getLogRotator(): AuditLogRotator {
  if (!rotator) {
    rotator = new AuditLogRotator();
  }
  return rotator;
}