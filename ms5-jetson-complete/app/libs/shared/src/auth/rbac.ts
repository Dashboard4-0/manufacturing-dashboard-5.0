import { logger } from '../logger';

export enum Role {
  ADMIN = 'admin',
  MANAGER = 'manager',
  SUPERVISOR = 'supervisor',
  OPERATOR = 'operator',
  VIEWER = 'viewer',
  SERVICE = 'service',
}

export enum Permission {
  // System
  SYSTEM_ADMIN = 'system:admin',
  SYSTEM_CONFIG = 'system:config',

  // Actions
  ACTION_CREATE = 'action:create',
  ACTION_READ = 'action:read',
  ACTION_UPDATE = 'action:update',
  ACTION_DELETE = 'action:delete',
  ACTION_APPROVE = 'action:approve',

  // OEE & Analytics
  OEE_READ = 'oee:read',
  OEE_WRITE = 'oee:write',
  ANALYTICS_READ = 'analytics:read',
  ANALYTICS_WRITE = 'analytics:write',

  // Operator Care
  OPERATOR_READ = 'operator:read',
  OPERATOR_WRITE = 'operator:write',
  CAPABILITY_MANAGE = 'capability:manage',

  // Maintenance
  MAINTENANCE_READ = 'maintenance:read',
  MAINTENANCE_WRITE = 'maintenance:write',
  MAINTENANCE_APPROVE = 'maintenance:approve',

  // Centerline
  CENTERLINE_READ = 'centerline:read',
  CENTERLINE_WRITE = 'centerline:write',
  CENTERLINE_APPROVE = 'centerline:approve',

  // Quality
  QUALITY_READ = 'quality:read',
  QUALITY_WRITE = 'quality:write',
  SPC_MANAGE = 'spc:manage',

  // Assets
  ASSET_READ = 'asset:read',
  ASSET_WRITE = 'asset:write',
  TELEMETRY_READ = 'telemetry:read',

  // Standard Work
  STANDARD_WORK_READ = 'standardwork:read',
  STANDARD_WORK_WRITE = 'standardwork:write',
  STANDARD_WORK_APPROVE = 'standardwork:approve',

  // Problem Solving
  PROBLEM_READ = 'problem:read',
  PROBLEM_WRITE = 'problem:write',
  RCA_MANAGE = 'rca:manage',

  // Andon
  ANDON_TRIGGER = 'andon:trigger',
  ANDON_RESPOND = 'andon:respond',
  ANDON_MANAGE = 'andon:manage',

  // Handover
  HANDOVER_READ = 'handover:read',
  HANDOVER_WRITE = 'handover:write',

  // Safety
  SAFETY_READ = 'safety:read',
  SAFETY_WRITE = 'safety:write',
  PERMIT_APPROVE = 'permit:approve',
  LOTO_MANAGE = 'loto:manage',

  // Skills
  SKILL_READ = 'skill:read',
  SKILL_WRITE = 'skill:write',
  TRAINING_MANAGE = 'training:manage',

  // Energy
  ENERGY_READ = 'energy:read',
  ENERGY_WRITE = 'energy:write',

  // Compliance
  COMPLIANCE_READ = 'compliance:read',
  COMPLIANCE_WRITE = 'compliance:write',
  AUDIT_PERFORM = 'audit:perform',

  // Master Data
  MASTER_DATA_READ = 'masterdata:read',
  MASTER_DATA_WRITE = 'masterdata:write',

  // Integration
  INTEGRATION_READ = 'integration:read',
  INTEGRATION_MANAGE = 'integration:manage',

  // Governance
  GOVERNANCE_READ = 'governance:read',
  GOVERNANCE_ASSESS = 'governance:assess',
}

const rolePermissions: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),

  [Role.MANAGER]: [
    Permission.ACTION_CREATE,
    Permission.ACTION_READ,
    Permission.ACTION_UPDATE,
    Permission.ACTION_DELETE,
    Permission.ACTION_APPROVE,
    Permission.OEE_READ,
    Permission.OEE_WRITE,
    Permission.ANALYTICS_READ,
    Permission.ANALYTICS_WRITE,
    Permission.OPERATOR_READ,
    Permission.OPERATOR_WRITE,
    Permission.CAPABILITY_MANAGE,
    Permission.MAINTENANCE_READ,
    Permission.MAINTENANCE_WRITE,
    Permission.MAINTENANCE_APPROVE,
    Permission.CENTERLINE_READ,
    Permission.CENTERLINE_WRITE,
    Permission.CENTERLINE_APPROVE,
    Permission.QUALITY_READ,
    Permission.QUALITY_WRITE,
    Permission.SPC_MANAGE,
    Permission.ASSET_READ,
    Permission.ASSET_WRITE,
    Permission.TELEMETRY_READ,
    Permission.STANDARD_WORK_READ,
    Permission.STANDARD_WORK_WRITE,
    Permission.STANDARD_WORK_APPROVE,
    Permission.PROBLEM_READ,
    Permission.PROBLEM_WRITE,
    Permission.RCA_MANAGE,
    Permission.ANDON_MANAGE,
    Permission.HANDOVER_READ,
    Permission.HANDOVER_WRITE,
    Permission.SAFETY_READ,
    Permission.SAFETY_WRITE,
    Permission.PERMIT_APPROVE,
    Permission.LOTO_MANAGE,
    Permission.SKILL_READ,
    Permission.SKILL_WRITE,
    Permission.TRAINING_MANAGE,
    Permission.ENERGY_READ,
    Permission.ENERGY_WRITE,
    Permission.COMPLIANCE_READ,
    Permission.COMPLIANCE_WRITE,
    Permission.AUDIT_PERFORM,
    Permission.MASTER_DATA_READ,
    Permission.INTEGRATION_READ,
    Permission.GOVERNANCE_READ,
    Permission.GOVERNANCE_ASSESS,
  ],

  [Role.SUPERVISOR]: [
    Permission.ACTION_CREATE,
    Permission.ACTION_READ,
    Permission.ACTION_UPDATE,
    Permission.OEE_READ,
    Permission.ANALYTICS_READ,
    Permission.OPERATOR_READ,
    Permission.OPERATOR_WRITE,
    Permission.MAINTENANCE_READ,
    Permission.MAINTENANCE_WRITE,
    Permission.CENTERLINE_READ,
    Permission.QUALITY_READ,
    Permission.QUALITY_WRITE,
    Permission.ASSET_READ,
    Permission.TELEMETRY_READ,
    Permission.STANDARD_WORK_READ,
    Permission.PROBLEM_READ,
    Permission.PROBLEM_WRITE,
    Permission.ANDON_TRIGGER,
    Permission.ANDON_RESPOND,
    Permission.HANDOVER_READ,
    Permission.HANDOVER_WRITE,
    Permission.SAFETY_READ,
    Permission.SAFETY_WRITE,
    Permission.SKILL_READ,
    Permission.ENERGY_READ,
    Permission.COMPLIANCE_READ,
    Permission.MASTER_DATA_READ,
  ],

  [Role.OPERATOR]: [
    Permission.ACTION_READ,
    Permission.OEE_READ,
    Permission.ANALYTICS_READ,
    Permission.OPERATOR_READ,
    Permission.MAINTENANCE_READ,
    Permission.CENTERLINE_READ,
    Permission.QUALITY_READ,
    Permission.ASSET_READ,
    Permission.TELEMETRY_READ,
    Permission.STANDARD_WORK_READ,
    Permission.PROBLEM_READ,
    Permission.ANDON_TRIGGER,
    Permission.HANDOVER_READ,
    Permission.HANDOVER_WRITE,
    Permission.SAFETY_READ,
    Permission.SKILL_READ,
    Permission.ENERGY_READ,
    Permission.MASTER_DATA_READ,
  ],

  [Role.VIEWER]: [
    Permission.ACTION_READ,
    Permission.OEE_READ,
    Permission.ANALYTICS_READ,
    Permission.OPERATOR_READ,
    Permission.MAINTENANCE_READ,
    Permission.CENTERLINE_READ,
    Permission.QUALITY_READ,
    Permission.ASSET_READ,
    Permission.TELEMETRY_READ,
    Permission.STANDARD_WORK_READ,
    Permission.PROBLEM_READ,
    Permission.HANDOVER_READ,
    Permission.SAFETY_READ,
    Permission.SKILL_READ,
    Permission.ENERGY_READ,
    Permission.COMPLIANCE_READ,
    Permission.MASTER_DATA_READ,
    Permission.INTEGRATION_READ,
    Permission.GOVERNANCE_READ,
  ],

  [Role.SERVICE]: [
    Permission.TELEMETRY_READ,
    Permission.INTEGRATION_READ,
    Permission.INTEGRATION_MANAGE,
  ],
};

export interface User {
  id: string;
  email: string;
  roles: Role[];
  permissions?: Permission[];
  metadata?: Record<string, unknown>;
}

export class RBACManager {
  private userCache: Map<string, User> = new Map();

  hasRole(user: User, role: Role): boolean {
    return user.roles.includes(role);
  }

  hasPermission(user: User, permission: Permission): boolean {
    if (user.permissions?.includes(permission)) {
      return true;
    }

    for (const role of user.roles) {
      if (rolePermissions[role]?.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  hasAnyPermission(user: User, permissions: Permission[]): boolean {
    return permissions.some(permission => this.hasPermission(user, permission));
  }

  hasAllPermissions(user: User, permissions: Permission[]): boolean {
    return permissions.every(permission => this.hasPermission(user, permission));
  }

  getUserPermissions(user: User): Permission[] {
    const permissions = new Set<Permission>(user.permissions || []);

    for (const role of user.roles) {
      const rolePerms = rolePermissions[role] || [];
      rolePerms.forEach(perm => permissions.add(perm));
    }

    return Array.from(permissions);
  }

  canAccessResource(user: User, resource: string, action: string): boolean {
    const permission = `${resource}:${action}` as Permission;
    return this.hasPermission(user, permission);
  }

  filterResourcesByPermission<T extends { id: string }>(
    user: User,
    resources: T[],
    permission: Permission,
  ): T[] {
    if (!this.hasPermission(user, permission)) {
      return [];
    }
    return resources;
  }

  async cacheUser(user: User): Promise<void> {
    this.userCache.set(user.id, user);
    logger.debug({ userId: user.id, roles: user.roles }, 'User cached');
  }

  async getCachedUser(userId: string): Promise<User | undefined> {
    return this.userCache.get(userId);
  }

  async clearUserCache(userId?: string): Promise<void> {
    if (userId) {
      this.userCache.delete(userId);
    } else {
      this.userCache.clear();
    }
  }
}

export const rbacManager = new RBACManager();