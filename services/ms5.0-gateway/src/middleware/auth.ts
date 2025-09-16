import { Request, Response, NextFunction } from 'express';
import { getOIDCClient } from '@ms5/shared/auth/oidc';
import { rbacManager } from '@ms5/shared/auth/rbac';
import { createLogger } from '@ms5/shared/logger';

const logger = createLogger('gateway-auth');

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    roles: string[];
    permissions?: string[];
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({
      type: 'https://httpstatuses.com/401',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing authentication token',
    });
    return;
  }

  try {
    const oidcClient = await getOIDCClient();
    const payload = await oidcClient.verifyToken(token);

    req.user = {
      id: payload.sub as string,
      email: payload.email as string,
      roles: (payload.roles as string[]) || [],
      permissions: payload.permissions as string[],
    };

    await rbacManager.cacheUser({
      id: req.user.id,
      email: req.user.email,
      roles: req.user.roles as any,
      permissions: req.user.permissions as any,
    });

    next();
  } catch (error) {
    logger.warn({ error }, 'Authentication failed');
    res.status(401).json({
      type: 'https://httpstatuses.com/401',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid authentication token',
    });
  }
}

export function requireRole(role: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        type: 'https://httpstatuses.com/401',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authentication required',
      });
      return;
    }

    if (!req.user.roles.includes(role)) {
      res.status(403).json({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: `Role '${role}' required`,
      });
      return;
    }

    next();
  };
}

export function requirePermission(permission: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        type: 'https://httpstatuses.com/401',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authentication required',
      });
      return;
    }

    const user = await rbacManager.getCachedUser(req.user.id);
    if (!user || !rbacManager.hasPermission(user, permission as any)) {
      res.status(403).json({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: `Permission '${permission}' required`,
      });
      return;
    }

    next();
  };
}