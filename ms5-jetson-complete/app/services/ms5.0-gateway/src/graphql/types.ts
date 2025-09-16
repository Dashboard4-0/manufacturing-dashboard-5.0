// GraphQL Type Definitions

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  token?: string;
}

export interface Site {
  id: string;
  name: string;
  location: string;
  timezone: string;
  areas?: Area[];
}

export interface Area {
  id: string;
  siteId: string;
  name: string;
  description?: string;
  lines?: ProductionLine[];
}

export interface ProductionLine {
  id: string;
  areaId: string;
  name: string;
  status: 'RUNNING' | 'STOPPED' | 'MAINTENANCE' | 'CHANGEOVER';
  currentShift?: string;
  currentOEE?: number;
  assets?: Asset[];
}

export interface Asset {
  id: string;
  lineId: string;
  name: string;
  type: string;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  lastMaintenance?: Date;
  specifications?: Record<string, unknown>;
}

export interface TierBoard {
  id: string;
  lineId: string;
  boardType: 'SQDC' | 'TIER1' | 'TIER2' | 'TIER3';
  date: Date;
  shift?: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Action {
  id: string;
  tierBoardId?: string;
  boardType: string;
  category: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  assignedTo?: string;
  dueDate?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AndonCall {
  id: string;
  lineId: string;
  stationId: string;
  type: 'QUALITY' | 'MAINTENANCE' | 'MATERIAL' | 'SAFETY' | 'OTHER';
  status: 'TRIGGERED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED';
  triggeredBy: string;
  triggeredAt: Date;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  responseTimeSeconds?: number;
  resolutionTimeSeconds?: number;
  escalationLevel: number;
  notes?: string;
}

export interface OEEMetrics {
  assetId: string;
  lineId?: string;
  timestamp: Date;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  plannedTime: number;
  runtime: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  reworkCount: number;
}

export interface LossEvent {
  id: string;
  assetId: string;
  lineId?: string;
  lossType: string;
  category: string;
  startTime: Date;
  endTime?: Date;
  durationMinutes?: number;
  impactedUnits?: number;
  reason?: string;
  rootCause?: string;
  actions?: string[];
}

export interface TelemetryData {
  assetId: string;
  timestamp: Date;
  metrics: Record<string, number>;
  status?: string;
  quality?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphQLFilterArgs {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
  startDate?: Date;
  endDate?: Date;
  [key: string]: unknown;
}

export interface CreateActionInput {
  boardType: string;
  category: string;
  description: string;
  assignedTo?: string;
  dueDate?: Date;
  tierBoardId?: string;
}

export interface UpdateActionInput {
  status?: string;
  assignedTo?: string;
  dueDate?: Date;
  description?: string;
  notes?: string;
}

export interface TriggerAndonInput {
  lineId: string;
  stationId: string;
  type: string;
  notes?: string;
}

export interface DataSourceResponse<T> {
  data?: T;
  error?: string;
  statusCode?: number;
}