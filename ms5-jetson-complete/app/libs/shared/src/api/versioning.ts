import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger';
import semver from 'semver';

const logger = createLogger('api-versioning');

export interface VersionConfig {
  defaultVersion?: string;
  supportedVersions?: string[];
  deprecatedVersions?: string[];
  headerName?: string;
  queryParam?: string;
  pathPattern?: RegExp;
  strategy?: 'header' | 'path' | 'query' | 'accept';
  strict?: boolean;
}

export interface VersionInfo {
  version: string;
  deprecated: boolean;
  sunsetDate?: Date;
  migrationGuide?: string;
}

export class ApiVersionManager {
  private config: Required<VersionConfig>;
  private versionHandlers = new Map<string, Map<string, Function>>();
  private versionInfo = new Map<string, VersionInfo>();

  constructor(config: VersionConfig = {}) {
    this.config = {
      defaultVersion: config.defaultVersion || 'v1',
      supportedVersions: config.supportedVersions || ['v1'],
      deprecatedVersions: config.deprecatedVersions || [],
      headerName: config.headerName || 'x-api-version',
      queryParam: config.queryParam || 'version',
      pathPattern: config.pathPattern || /^\/api\/(v\d+)\//,
      strategy: config.strategy || 'header',
      strict: config.strict ?? false
    };

    this.initializeVersions();
  }

  private initializeVersions(): void {
    for (const version of this.config.supportedVersions) {
      const info: VersionInfo = {
        version,
        deprecated: this.config.deprecatedVersions.includes(version)
      };

      const sunsetDate = this.getSunsetDate(version);
      if (sunsetDate) info.sunsetDate = sunsetDate;

      const migrationGuide = this.getMigrationGuide(version);
      if (migrationGuide) info.migrationGuide = migrationGuide;

      this.versionInfo.set(version, info);

      this.versionHandlers.set(version, new Map());
    }
  }

  private getSunsetDate(version: string): Date | undefined {
    // Calculate sunset date for deprecated versions (6 months from deprecation)
    if (this.config.deprecatedVersions.includes(version)) {
      const date = new Date();
      date.setMonth(date.getMonth() + 6);
      return date;
    }
    return undefined;
  }

  private getMigrationGuide(version: string): string | undefined {
    // Return migration guide URL based on version
    if (this.config.deprecatedVersions.includes(version)) {
      return `https://docs.ms5.com/api/migration/${version}-to-${this.getNextVersion(version)}`;
    }
    return undefined;
  }

  private getNextVersion(version: string): string {
    const versions = this.config.supportedVersions.sort();
    const index = versions.indexOf(version);
    return index < versions.length - 1 ? versions[index + 1] : version;
  }

  extractVersion(req: Request): string {
    let version: string | undefined;

    switch (this.config.strategy) {
      case 'header':
        version = req.headers[this.config.headerName] as string;
        break;

      case 'path':
        const match = req.path.match(this.config.pathPattern);
        version = match ? match[1] : undefined;
        break;

      case 'query':
        version = req.query[this.config.queryParam] as string;
        break;

      case 'accept':
        const accept = req.headers.accept || '';
        const acceptMatch = accept.match(/application\/vnd\.ms5\.(v\d+)\+json/);
        version = acceptMatch ? acceptMatch[1] : undefined;
        break;

      default:
        version = undefined;
    }

    // Validate version
    if (version && !this.config.supportedVersions.includes(version)) {
      if (this.config.strict) {
        throw new Error(`Unsupported API version: ${version}`);
      }
      logger.warn({ version, path: req.path }, 'Unsupported API version requested');
      version = this.config.defaultVersion;
    }

    return version || this.config.defaultVersion;
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const version = this.extractVersion(req);
        
        // Attach version to request
        (req as any).apiVersion = version;

        // Set response headers
        res.setHeader('x-api-version', version);

        // Add deprecation warning if applicable
        const info = this.versionInfo.get(version);
        if (info?.deprecated) {
          res.setHeader('x-api-deprecated', 'true');
          if (info.sunsetDate) {
            res.setHeader('x-api-sunset', info.sunsetDate.toISOString());
          }
          if (info.migrationGuide) {
            res.setHeader('x-api-migration-guide', info.migrationGuide);
          }

          logger.warn({
            version,
            path: req.path,
            sunsetDate: info.sunsetDate
          }, 'Deprecated API version used');
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  route(
    path: string,
    handlers: { [version: string]: Function }
  ) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const version = (req as any).apiVersion || this.config.defaultVersion;
      const handler = handlers[version] || handlers[this.config.defaultVersion];

      if (!handler) {
        return res.status(501).json({
          error: 'Not Implemented',
          message: `Endpoint not available for API version ${version}`,
          supportedVersions: Object.keys(handlers)
        });
      }

      try {
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  registerHandler(
    version: string,
    endpoint: string,
    handler: Function
  ): void {
    const versionHandlers = this.versionHandlers.get(version);
    if (!versionHandlers) {
      throw new Error(`Version ${version} is not supported`);
    }

    versionHandlers.set(endpoint, handler);
    logger.debug({ version, endpoint }, 'Handler registered');
  }

  getHandler(version: string, endpoint: string): Function | undefined {
    return this.versionHandlers.get(version)?.get(endpoint);
  }

  // Version compatibility checking
  isCompatible(requestedVersion: string, minimumVersion: string): boolean {
    try {
      return semver.gte(requestedVersion, minimumVersion);
    } catch {
      // Fallback for non-semver versions
      const requested = parseInt(requestedVersion.replace(/\D/g, ''));
      const minimum = parseInt(minimumVersion.replace(/\D/g, ''));
      return requested >= minimum;
    }
  }

  // Feature availability by version
  hasFeature(version: string, feature: string): boolean {
    const features: { [key: string]: string[] } = {
      v1: ['basic-auth', 'rest-api', 'webhooks'],
      v2: ['oauth2', 'graphql', 'websockets', 'rate-limiting'],
      v3: ['federation', 'subscriptions', 'batch-operations', 'streaming']
    };

    const versionFeatures = features[version] || [];
    const inheritedFeatures = this.getInheritedFeatures(version);
    
    return versionFeatures.includes(feature) || inheritedFeatures.includes(feature);
  }

  private getInheritedFeatures(version: string): string[] {
    const features: string[] = [];
    const versions = this.config.supportedVersions.sort();
    
    for (const v of versions) {
      if (v === version) break;
      // Inherit features from previous versions
      const versionFeatures: { [key: string]: string[] } = {
        v1: ['basic-auth', 'rest-api', 'webhooks'],
        v2: ['oauth2', 'graphql', 'websockets', 'rate-limiting'],
        v3: ['federation', 'subscriptions', 'batch-operations', 'streaming']
      };
      features.push(...(versionFeatures[v] || []));
    }

    return features;
  }

  // Response transformation by version
  transformResponse(
    version: string,
    data: any,
    options: { fields?: string[]; exclude?: string[] } = {}
  ): any {
    const transformers: { [key: string]: (data: any) => any } = {
      v1: (data) => this.transformV1(data, options),
      v2: (data) => this.transformV2(data, options),
      v3: (data) => data // V3 returns raw data
    };

    const transformer = transformers[version] || transformers[this.config.defaultVersion];
    return transformer(data);
  }

  private transformV1(
    data: any,
    options: { fields?: string[]; exclude?: string[] }
  ): any {
    // V1 transformation: Remove internal fields, flatten nested objects
    const transformed = { ...data };
    
    // Remove internal fields
    delete transformed._id;
    delete transformed.__v;
    delete transformed.internal;

    // Apply field filtering
    if (options.fields) {
      const filtered: any = {};
      for (const field of options.fields) {
        if (field in transformed) {
          filtered[field] = transformed[field];
        }
      }
      return filtered;
    }

    // Apply exclusions
    if (options.exclude) {
      for (const field of options.exclude) {
        delete transformed[field];
      }
    }

    return transformed;
  }

  private transformV2(
    data: any,
    options: { fields?: string[]; exclude?: string[] }
  ): any {
    // V2 transformation: Add metadata wrapper
    const transformed = this.transformV1(data, options);
    
    return {
      data: transformed,
      metadata: {
        version: 'v2',
        timestamp: new Date().toISOString()
      }
    };
  }

  // Version migration helpers
  async migrate(
    fromVersion: string,
    toVersion: string,
    data: any
  ): Promise<any> {
    const migrations: { [key: string]: (data: any) => Promise<any> } = {
      'v1-v2': this.migrateV1ToV2.bind(this),
      'v2-v3': this.migrateV2ToV3.bind(this)
    };

    const migrationKey = `${fromVersion}-${toVersion}`;
    const migration = migrations[migrationKey];

    if (!migration) {
      throw new Error(`No migration path from ${fromVersion} to ${toVersion}`);
    }

    return migration(data);
  }

  private async migrateV1ToV2(data: any): Promise<any> {
    // V1 to V2 migration logic
    return {
      ...data,
      version: 'v2',
      migratedAt: new Date().toISOString()
    };
  }

  private async migrateV2ToV3(data: any): Promise<any> {
    // V2 to V3 migration logic
    if (data.metadata) {
      const { metadata, ...rest } = data;
      return {
        ...rest,
        _metadata: metadata,
        version: 'v3'
      };
    }
    return data;
  }

  getVersionInfo(): Map<string, VersionInfo> {
    return new Map(this.versionInfo);
  }

  getDeprecationReport(): Array<{
    version: string;
    sunsetDate: Date;
    affectedEndpoints: string[];
    migrationGuide: string;
  }> {
    const report: any[] = [];

    for (const [version, info] of this.versionInfo) {
      if (info.deprecated) {
        const handlers = this.versionHandlers.get(version);
        report.push({
          version,
          sunsetDate: info.sunsetDate!,
          affectedEndpoints: handlers ? Array.from(handlers.keys()) : [],
          migrationGuide: info.migrationGuide!
        });
      }
    }

    return report;
  }
}

// Factory functions for common versioning strategies
export function createHeaderVersioning(): ApiVersionManager {
  return new ApiVersionManager({
    strategy: 'header',
    headerName: 'x-api-version',
    supportedVersions: ['v1', 'v2', 'v3'],
    deprecatedVersions: ['v1'],
    defaultVersion: 'v2'
  });
}

export function createPathVersioning(): ApiVersionManager {
  return new ApiVersionManager({
    strategy: 'path',
    pathPattern: /^\/api\/(v\d+)\//,
    supportedVersions: ['v1', 'v2', 'v3'],
    deprecatedVersions: ['v1'],
    defaultVersion: 'v2'
  });
}

export function createAcceptVersioning(): ApiVersionManager {
  return new ApiVersionManager({
    strategy: 'accept',
    supportedVersions: ['v1', 'v2', 'v3'],
    deprecatedVersions: ['v1'],
    defaultVersion: 'v2'
  });
}

// Decorator for versioned endpoints
export function ApiVersion(version: string | string[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const versions = Array.isArray(version) ? version : [version];

    descriptor.value = async function (...args: any[]) {
      const [req, res, next] = args;
      const requestVersion = (req as any).apiVersion;

      if (!versions.includes(requestVersion)) {
        return res.status(400).json({
          error: 'Version Mismatch',
          message: `This endpoint requires API version ${versions.join(' or ')}`,
          currentVersion: requestVersion
        });
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}