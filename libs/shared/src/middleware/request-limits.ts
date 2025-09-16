import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger';
import multer from 'multer';
import { IncomingMessage } from 'http';

const logger = createLogger('request-limits');

export interface RequestLimitConfig {
  maxRequestSize?: string | number;
  maxUrlLength?: number;
  maxHeaderSize?: number;
  maxFieldSize?: string | number;
  maxFileSize?: string | number;
  maxFiles?: number;
  maxFields?: number;
  maxFieldNameLength?: number;
  maxQueryStringLength?: number;
  allowedMimeTypes?: string[];
  blockedMimeTypes?: string[];
  customValidators?: Array<(req: Request) => boolean | Promise<boolean>>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: Record<string, any>;
}

export class RequestLimiter {
  private config: Required<RequestLimitConfig>;
  private upload: multer.Multer;

  constructor(config: RequestLimitConfig = {}) {
    this.config = {
      maxRequestSize: config.maxRequestSize || '10mb',
      maxUrlLength: config.maxUrlLength || 2048,
      maxHeaderSize: config.maxHeaderSize || 8192,
      maxFieldSize: config.maxFieldSize || '1mb',
      maxFileSize: config.maxFileSize || '50mb',
      maxFiles: config.maxFiles || 10,
      maxFields: config.maxFields || 100,
      maxFieldNameLength: config.maxFieldNameLength || 100,
      maxQueryStringLength: config.maxQueryStringLength || 1024,
      allowedMimeTypes: config.allowedMimeTypes || [],
      blockedMimeTypes: config.blockedMimeTypes || [
        'application/x-msdownload',
        'application/x-msdos-program',
        'application/x-executable',
        'application/x-dosexec'
      ],
      customValidators: config.customValidators || []
    };

    // Configure multer for file uploads
    this.upload = multer({
      limits: {
        fileSize: this.parseSize(this.config.maxFileSize),
        files: this.config.maxFiles,
        fields: this.config.maxFields,
        fieldSize: this.parseSize(this.config.maxFieldSize),
        fieldNameSize: this.config.maxFieldNameLength
      },
      fileFilter: this.createFileFilter()
    });
  }

  private parseSize(size: string | number): number {
    if (typeof size === 'number') return size;
    
    const units: Record<string, number> = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024
    };

    const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);
    if (!match) throw new Error(`Invalid size format: ${size}`);

    const value = parseFloat(match[1]);
    const unit = match[2] || 'b';
    
    return Math.floor(value * units[unit]);
  }

  private createFileFilter() {
    return (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
      // Check blocked MIME types
      if (this.config.blockedMimeTypes.includes(file.mimetype)) {
        cb(new Error(`File type ${file.mimetype} is not allowed`));
        return;
      }

      // Check allowed MIME types if specified
      if (this.config.allowedMimeTypes.length > 0 && 
          !this.config.allowedMimeTypes.includes(file.mimetype)) {
        cb(new Error(`File type ${file.mimetype} is not in allowed list`));
        return;
      }

      // Additional security checks
      if (this.hasExecutableExtension(file.originalname)) {
        cb(new Error('Executable files are not allowed'));
        return;
      }

      cb(null, true);
    };
  }

  private hasExecutableExtension(filename: string): boolean {
    const dangerousExtensions = [
      '.exe', '.dll', '.com', '.bat', '.cmd', '.scr',
      '.msi', '.vbs', '.js', '.jar', '.app', '.deb',
      '.rpm', '.sh', '.bash', '.ps1', '.psm1'
    ];

    const ext = filename.toLowerCase();
    return dangerousExtensions.some(dangerous => ext.endsWith(dangerous));
  }

  validateUrl(req: Request): ValidationResult {
    const url = req.originalUrl || req.url;
    
    if (url.length > this.config.maxUrlLength) {
      return {
        valid: false,
        error: 'URL too long',
        details: {
          length: url.length,
          maxLength: this.config.maxUrlLength
        }
      };
    }

    // Check for path traversal attempts
    if (url.includes('..') || url.includes('//')) {
      return {
        valid: false,
        error: 'Invalid URL pattern detected',
        details: { url }
      };
    }

    // Check query string length
    const queryString = req.url.split('?')[1] || '';
    if (queryString.length > this.config.maxQueryStringLength) {
      return {
        valid: false,
        error: 'Query string too long',
        details: {
          length: queryString.length,
          maxLength: this.config.maxQueryStringLength
        }
      };
    }

    return { valid: true };
  }

  validateHeaders(req: Request): ValidationResult {
    const headerSize = Object.entries(req.headers)
      .reduce((size, [key, value]) => {
        return size + key.length + (Array.isArray(value) 
          ? value.join(',').length 
          : String(value).length);
      }, 0);

    if (headerSize > this.config.maxHeaderSize) {
      return {
        valid: false,
        error: 'Headers too large',
        details: {
          size: headerSize,
          maxSize: this.config.maxHeaderSize
        }
      };
    }

    // Check for suspicious headers
    const suspiciousHeaders = [
      'x-forwarded-host',
      'x-original-url',
      'x-rewrite-url'
    ];

    for (const header of suspiciousHeaders) {
      if (req.headers[header]) {
        logger.warn({
          header,
          value: req.headers[header],
          ip: req.ip
        }, 'Suspicious header detected');
      }
    }

    return { valid: true };
  }

  validateBody(req: Request): ValidationResult {
    if (!req.body) return { valid: true };

    const bodySize = JSON.stringify(req.body).length;
    const maxSize = this.parseSize(this.config.maxRequestSize);

    if (bodySize > maxSize) {
      return {
        valid: false,
        error: 'Request body too large',
        details: {
          size: bodySize,
          maxSize
        }
      };
    }

    // Check for deeply nested objects (potential DoS)
    if (this.hasDeepNesting(req.body, 10)) {
      return {
        valid: false,
        error: 'Request body has excessive nesting',
        details: { maxDepth: 10 }
      };
    }

    // Check field count
    const fieldCount = this.countFields(req.body);
    if (fieldCount > this.config.maxFields) {
      return {
        valid: false,
        error: 'Too many fields in request',
        details: {
          count: fieldCount,
          maxFields: this.config.maxFields
        }
      };
    }

    return { valid: true };
  }

  private hasDeepNesting(obj: any, maxDepth: number, currentDepth: number = 0): boolean {
    if (currentDepth > maxDepth) return true;
    
    if (typeof obj !== 'object' || obj === null) return false;

    for (const value of Object.values(obj)) {
      if (this.hasDeepNesting(value, maxDepth, currentDepth + 1)) {
        return true;
      }
    }

    return false;
  }

  private countFields(obj: any): number {
    let count = 0;
    
    if (typeof obj !== 'object' || obj === null) return 1;

    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        count += this.countFields(value);
      } else {
        count++;
      }
    }

    return count;
  }

  async validateCustom(req: Request): Promise<ValidationResult> {
    for (const validator of this.config.customValidators) {
      try {
        const result = await validator(req);
        if (!result) {
          return {
            valid: false,
            error: 'Custom validation failed'
          };
        }
      } catch (error) {
        logger.error({ error }, 'Custom validator error');
        return {
          valid: false,
          error: 'Validation error',
          details: { error: (error as Error).message }
        };
      }
    }

    return { valid: true };
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Validate URL
      const urlValidation = this.validateUrl(req);
      if (!urlValidation.valid) {
        logger.warn({
          ...urlValidation,
          ip: req.ip,
          path: req.path
        }, 'URL validation failed');
        return res.status(400).json({
          error: urlValidation.error,
          details: urlValidation.details
        });
      }

      // Validate headers
      const headerValidation = this.validateHeaders(req);
      if (!headerValidation.valid) {
        logger.warn({
          ...headerValidation,
          ip: req.ip,
          path: req.path
        }, 'Header validation failed');
        return res.status(431).json({
          error: headerValidation.error,
          details: headerValidation.details
        });
      }

      // Validate body
      const bodyValidation = this.validateBody(req);
      if (!bodyValidation.valid) {
        logger.warn({
          ...bodyValidation,
          ip: req.ip,
          path: req.path
        }, 'Body validation failed');
        return res.status(413).json({
          error: bodyValidation.error,
          details: bodyValidation.details
        });
      }

      // Run custom validators
      const customValidation = await this.validateCustom(req);
      if (!customValidation.valid) {
        logger.warn({
          ...customValidation,
          ip: req.ip,
          path: req.path
        }, 'Custom validation failed');
        return res.status(400).json({
          error: customValidation.error,
          details: customValidation.details
        });
      }

      next();
    };
  }

  // Middleware for file uploads
  fileUploadMiddleware(fieldName: string = 'file') {
    return this.upload.single(fieldName);
  }

  multiFileUploadMiddleware(fieldName: string = 'files') {
    return this.upload.array(fieldName, this.config.maxFiles);
  }

  // Content Security Policy headers
  securityHeaders() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Prevent MIME type sniffing
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      // Prevent clickjacking
      res.setHeader('X-Frame-Options', 'DENY');
      
      // Enable XSS protection
      res.setHeader('X-XSS-Protection', '1; mode=block');
      
      // Content Security Policy
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
      );
      
      // Referrer Policy
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      // Feature Policy
      res.setHeader(
        'Permissions-Policy',
        'geolocation=(), microphone=(), camera=()'
      );

      next();
    };
  }
}

// Factory functions for different security levels
export function createStandardLimiter(): RequestLimiter {
  return new RequestLimiter({
    maxRequestSize: '10mb',
    maxFileSize: '50mb',
    maxFiles: 10
  });
}

export function createStrictLimiter(): RequestLimiter {
  return new RequestLimiter({
    maxRequestSize: '1mb',
    maxFileSize: '10mb',
    maxFiles: 5,
    maxUrlLength: 1024,
    maxHeaderSize: 4096,
    allowedMimeTypes: [
      'application/json',
      'text/plain',
      'image/jpeg',
      'image/png',
      'application/pdf'
    ]
  });
}

export function createApiLimiter(): RequestLimiter {
  return new RequestLimiter({
    maxRequestSize: '5mb',
    maxFileSize: '0', // No file uploads
    maxFiles: 0,
    customValidators: [
      // Only allow JSON content type
      (req) => {
        const contentType = req.headers['content-type'];
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          return contentType?.includes('application/json') || false;
        }
        return true;
      }
    ]
  });
}

// GraphQL-specific limiter
export function createGraphQLLimiter(): RequestLimiter {
  return new RequestLimiter({
    maxRequestSize: '100kb',
    customValidators: [
      // Limit query depth
      async (req) => {
        if (req.body?.query) {
          const depth = calculateQueryDepth(req.body.query);
          return depth <= 10; // Max depth of 10
        }
        return true;
      },
      // Limit query complexity
      async (req) => {
        if (req.body?.query) {
          const complexity = calculateQueryComplexity(req.body.query);
          return complexity <= 1000; // Max complexity of 1000
        }
        return true;
      }
    ]
  });
}

function calculateQueryDepth(query: string): number {
  // Simplified depth calculation
  let depth = 0;
  let maxDepth = 0;
  
  for (const char of query) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    maxDepth = Math.max(maxDepth, depth);
  }
  
  return maxDepth;
}

function calculateQueryComplexity(query: string): number {
  // Simplified complexity calculation
  // Count fields and multiply by depth
  const fields = (query.match(/\w+\s*:/g) || []).length;
  const depth = calculateQueryDepth(query);
  return fields * depth;
}