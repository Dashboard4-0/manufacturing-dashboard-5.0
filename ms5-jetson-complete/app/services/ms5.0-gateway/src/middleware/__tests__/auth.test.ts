import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware, requireRole, requirePermission } from '../auth';
import { verifyToken, checkPermission } from '@ms5/shared/auth';
import { auditLog } from '@ms5/shared/logger';

// Mock the shared auth module
vi.mock('@ms5/shared/auth', () => ({
  verifyToken: vi.fn(),
  checkPermission: vi.fn()
}));

vi.mock('@ms5/shared/logger', () => ({
  auditLog: vi.fn(),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }))
}));

describe('Authentication Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      headers: {},
      body: {},
      query: {},
      params: {},
      path: '/api/test'
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn()
    };
    next = vi.fn();
    vi.clearAllMocks();
  });

  describe('authMiddleware', () => {
    it('should reject requests without authorization header', async () => {
      await authMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No authorization token provided'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid authorization format', async () => {
      req.headers = { authorization: 'InvalidFormat token123' };

      await authMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid authorization format'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired tokens', async () => {
      req.headers = { authorization: 'Bearer expired-token' };
      (verifyToken as any).mockRejectedValue(new Error('Token expired'));

      await authMiddleware(req as Request, res as Response, next);

      expect(verifyToken).toHaveBeenCalledWith('expired-token');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Token expired'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid tokens', async () => {
      req.headers = { authorization: 'Bearer invalid-token' };
      (verifyToken as any).mockRejectedValue(new Error('Invalid signature'));

      await authMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid signature'
      });
      expect(auditLog).toHaveBeenCalledWith(
        'AUTH_FAILURE',
        '/api/test',
        expect.any(String),
        'FAILURE',
        expect.objectContaining({
          reason: 'Invalid signature'
        })
      );
    });

    it('should accept valid tokens and attach user to request', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'John Doe',
        role: 'operator',
        permissions: ['read:production', 'execute:andon']
      };
      (verifyToken as any).mockResolvedValue(mockUser);

      await authMiddleware(req as Request, res as Response, next);

      expect(verifyToken).toHaveBeenCalledWith('valid-token');
      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle token from query parameter for SSE endpoints', async () => {
      req.path = '/api/events';
      req.query = { token: 'query-token' };
      const mockUser = { id: 'user-123', role: 'operator' };
      (verifyToken as any).mockResolvedValue(mockUser);

      await authMiddleware(req as Request, res as Response, next);

      expect(verifyToken).toHaveBeenCalledWith('query-token');
      expect(req.user).toEqual(mockUser);
      expect(next).toHaveBeenCalled();
    });

    it('should skip authentication for health check endpoints', async () => {
      req.path = '/health';

      await authMiddleware(req as Request, res as Response, next);

      expect(verifyToken).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should skip authentication for metrics endpoints', async () => {
      req.path = '/metrics';

      await authMiddleware(req as Request, res as Response, next);

      expect(verifyToken).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should handle malformed JWT gracefully', async () => {
      req.headers = { authorization: 'Bearer malformed.jwt.token' };
      (verifyToken as any).mockRejectedValue(new Error('JWT malformed'));

      await authMiddleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'JWT malformed'
      });
    });

    it('should rate limit authentication failures', async () => {
      req.headers = { authorization: 'Bearer invalid-token' };
      req.ip = '192.168.1.100';
      (verifyToken as any).mockRejectedValue(new Error('Invalid token'));

      // Simulate multiple failed attempts
      for (let i = 0; i < 6; i++) {
        await authMiddleware(req as Request, res as Response, next);
      }

      // After 5 failures, should be rate limited
      expect(res.status).toHaveBeenLastCalledWith(429);
      expect(res.json).toHaveBeenLastCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Too many authentication attempts')
        })
      );
    });
  });

  describe('requireRole', () => {
    it('should reject users without required role', async () => {
      req.user = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'John Doe',
        role: 'operator',
        permissions: []
      };

      const middleware = requireRole('manager');
      await middleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient privileges',
        required: 'manager',
        current: 'operator'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept users with required role', async () => {
      req.user = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Jane Manager',
        role: 'manager',
        permissions: []
      };

      const middleware = requireRole('manager');
      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should accept multiple allowed roles', async () => {
      req.user = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Supervisor Sam',
        role: 'supervisor',
        permissions: []
      };

      const middleware = requireRole(['manager', 'supervisor', 'admin']);
      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should always accept admin role', async () => {
      req.user = {
        id: 'admin-123',
        email: 'admin@example.com',
        name: 'Admin User',
        role: 'admin',
        permissions: ['*']
      };

      const middleware = requireRole('manager');
      await middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should handle missing user object', async () => {
      req.user = undefined;

      const middleware = requireRole('manager');
      await middleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required'
      });
    });
  });

  describe('requirePermission', () => {
    beforeEach(() => {
      (checkPermission as any).mockImplementation((role: string, permission: string) => {
        const permissions: Record<string, string[]> = {
          admin: ['*'],
          manager: ['read:*', 'write:production', 'execute:reports'],
          supervisor: ['read:production', 'write:production:assigned', 'execute:andon'],
          operator: ['read:production:assigned', 'execute:andon']
        };

        const rolePerms = permissions[role] || [];
        if (rolePerms.includes('*')) return true;
        if (rolePerms.includes(permission)) return true;

        // Check wildcard permissions
        const permParts = permission.split(':');
        for (const perm of rolePerms) {
          const parts = perm.split(':');
          let match = true;
          for (let i = 0; i < parts.length; i++) {
            if (parts[i] !== '*' && parts[i] !== permParts[i]) {
              match = false;
              break;
            }
          }
          if (match) return true;
        }

        return false;
      });
    });

    it('should accept users with required permission', async () => {
      req.user = {
        id: 'user-123',
        email: 'manager@example.com',
        name: 'Manager',
        role: 'manager',
        permissions: []
      };

      const middleware = requirePermission('write:production');
      await middleware(req as Request, res as Response, next);

      expect(checkPermission).toHaveBeenCalledWith('manager', 'write:production');
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject users without required permission', async () => {
      req.user = {
        id: 'user-123',
        email: 'operator@example.com',
        name: 'Operator',
        role: 'operator',
        permissions: []
      };

      const middleware = requirePermission('write:production');
      await middleware(req as Request, res as Response, next);

      expect(checkPermission).toHaveBeenCalledWith('operator', 'write:production');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Permission denied',
        required: 'write:production'
      });
      expect(auditLog).toHaveBeenCalledWith(
        'PERMISSION_DENIED',
        expect.any(String),
        'user-123',
        'DENIED',
        expect.objectContaining({
          permission: 'write:production',
          role: 'operator'
        })
      );
    });

    it('should handle wildcard permissions', async () => {
      req.user = {
        id: 'user-123',
        email: 'manager@example.com',
        name: 'Manager',
        role: 'manager',
        permissions: []
      };

      const middleware = requirePermission('read:analytics');
      await middleware(req as Request, res as Response, next);

      expect(checkPermission).toHaveBeenCalledWith('manager', 'read:analytics');
      expect(next).toHaveBeenCalled(); // Manager has read:* permission
    });

    it('should check multiple permissions (AND logic)', async () => {
      req.user = {
        id: 'user-123',
        email: 'supervisor@example.com',
        name: 'Supervisor',
        role: 'supervisor',
        permissions: []
      };

      const middleware = requirePermission(['read:production', 'execute:andon']);
      await middleware(req as Request, res as Response, next);

      expect(checkPermission).toHaveBeenCalledWith('supervisor', 'read:production');
      expect(checkPermission).toHaveBeenCalledWith('supervisor', 'execute:andon');
      expect(next).toHaveBeenCalled();
    });

    it('should reject if any permission is missing', async () => {
      req.user = {
        id: 'user-123',
        email: 'operator@example.com',
        name: 'Operator',
        role: 'operator',
        permissions: []
      };

      const middleware = requirePermission(['read:production:assigned', 'write:production']);
      await middleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle missing user object', async () => {
      req.user = undefined;

      const middleware = requirePermission('read:production');
      await middleware(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required'
      });
    });

    it('should cache permission checks for performance', async () => {
      req.user = {
        id: 'user-123',
        email: 'manager@example.com',
        name: 'Manager',
        role: 'manager',
        permissions: []
      };

      const middleware = requirePermission('write:production');

      // Call multiple times
      await middleware(req as Request, res as Response, next);
      await middleware(req as Request, res as Response, next);
      await middleware(req as Request, res as Response, next);

      // Should use cached result after first call
      expect(checkPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('Security Headers', () => {
    it('should add security headers to responses', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      const mockUser = { id: 'user-123', role: 'operator' };
      (verifyToken as any).mockResolvedValue(mockUser);

      await authMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(res.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
    });
  });

  describe('CORS Handling', () => {
    it('should handle CORS preflight requests', async () => {
      req.method = 'OPTIONS';
      req.headers = {
        origin: 'https://app.ms5.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization'
      };

      await authMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://app.ms5.example.com'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'content-type, authorization'
      );
      expect(res.status).toHaveBeenCalledWith(204);
    });
  });

  describe('Token Refresh', () => {
    it('should send refresh token hint when token is about to expire', async () => {
      req.headers = { authorization: 'Bearer expiring-token' };
      const mockUser = {
        id: 'user-123',
        role: 'operator',
        exp: Math.floor(Date.now() / 1000) + 300 // Expires in 5 minutes
      };
      (verifyToken as any).mockResolvedValue(mockUser);

      await authMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Token-Expires-Soon', 'true');
      expect(res.setHeader).toHaveBeenCalledWith('X-Token-Expires-In', '300');
    });
  });

  describe('Audit Logging', () => {
    it('should log successful authentication', async () => {
      req.headers = { authorization: 'Bearer valid-token' };
      req.ip = '192.168.1.100';
      const mockUser = { id: 'user-123', email: 'user@example.com', role: 'operator' };
      (verifyToken as any).mockResolvedValue(mockUser);

      await authMiddleware(req as Request, res as Response, next);

      expect(auditLog).toHaveBeenCalledWith(
        'AUTH_SUCCESS',
        '/api/test',
        'user-123',
        'SUCCESS',
        expect.objectContaining({
          ip: '192.168.1.100',
          userAgent: undefined
        })
      );
    });

    it('should log authentication failures', async () => {
      req.headers = { authorization: 'Bearer invalid-token' };
      req.ip = '192.168.1.100';
      (verifyToken as any).mockRejectedValue(new Error('Invalid token'));

      await authMiddleware(req as Request, res as Response, next);

      expect(auditLog).toHaveBeenCalledWith(
        'AUTH_FAILURE',
        '/api/test',
        expect.any(String),
        'FAILURE',
        expect.objectContaining({
          reason: 'Invalid token',
          ip: '192.168.1.100'
        })
      );
    });

    it('should log permission denials', async () => {
      req.user = {
        id: 'user-123',
        email: 'operator@example.com',
        name: 'Operator',
        role: 'operator',
        permissions: []
      };

      const middleware = requirePermission('admin:write');
      await middleware(req as Request, res as Response, next);

      expect(auditLog).toHaveBeenCalledWith(
        'PERMISSION_DENIED',
        expect.any(String),
        'user-123',
        'DENIED',
        expect.objectContaining({
          permission: 'admin:write',
          role: 'operator'
        })
      );
    });
  });
});