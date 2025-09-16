import { PrismaClient } from '@prisma/client';
import DataLoader from 'dataloader';
import { Request, Response } from 'express';
import { createLogger } from '@ms5/shared/logger';
import { getOIDCClient } from '@ms5/shared/auth/oidc';
import {
  User,
  Site,
  ProductionLine,
  Asset,
  TierBoard,
  Action,
  AndonCall,
  OEEMetrics,
  LossEvent,
  TelemetryData,
  GraphQLFilterArgs,
  CreateActionInput,
  UpdateActionInput,
  TriggerAndonInput,
  DataSourceResponse
} from './types';

const prisma = new PrismaClient();
const logger = createLogger('gateway-context');

export interface Context {
  user: User | null;
  prisma: PrismaClient;
  req: Request;
  res: Response;
  correlationId: string;
  dataSources: {
    masterData: MasterDataSource;
    dms: DMSDataSource;
    analytics: AnalyticsDataSource;
    andon: AndonDataSource;
    telemetry: TelemetryDataSource;
  };
  loaders: {
    site: DataLoader<string, Site>;
    line: DataLoader<string, ProductionLine>;
    asset: DataLoader<string, Asset>;
  };
}

class MasterDataSource {
  constructor(private context: Context) {}

  async getSites() {
    const response = await fetch('http://master-data-service:3016/api/v1/sites', {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getSite(id: string) {
    return this.context.loaders.site.load(id);
  }

  async getAreas(siteId: string) {
    const response = await fetch(`http://master-data-service:3016/api/v1/areas?siteId=${siteId}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getAssets(lineId: string) {
    const response = await fetch(`http://master-data-service:3016/api/v1/assets?lineId=${lineId}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.context.user?.token}`,
    };
  }
}

class DMSDataSource {
  constructor(private context: Context) {}

  async getTierBoards(args: GraphQLFilterArgs): Promise<TierBoard[]> {
    const params = new URLSearchParams(args);
    const response = await fetch(`http://dms-service:3001/api/v1/tier-boards?${params}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getCurrentTierBoard(lineId: string) {
    const response = await fetch(`http://dms-service:3001/api/v1/tier-boards/current/${lineId}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getActions(args: GraphQLFilterArgs): Promise<Action[]> {
    const params = new URLSearchParams(args);
    const response = await fetch(`http://dms-service:3001/api/v1/actions?${params}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async createAction(input: CreateActionInput): Promise<Action> {
    const response = await fetch('http://dms-service:3001/api/v1/actions', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return response.json();
  }

  async updateAction(id: string, input: UpdateActionInput): Promise<Action> {
    const response = await fetch(`http://dms-service:3001/api/v1/actions/${id}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return response.json();
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.context.user?.token}`,
    };
  }
}

class AnalyticsDataSource {
  constructor(private context: Context) {}

  async getOEE(args: any) {
    const params = new URLSearchParams(args);
    const response = await fetch(`http://loss-analytics-service:3002/api/v1/oee?${params}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getCurrentOEE(lineId: string) {
    const response = await fetch(`http://loss-analytics-service:3002/api/v1/oee/current/${lineId}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getLosses(args: any) {
    const params = new URLSearchParams(args);
    const response = await fetch(`http://loss-analytics-service:3002/api/v1/losses?${params}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getSiteMetrics(siteId: string) {
    const response = await fetch(`http://loss-analytics-service:3002/api/v1/metrics/site/${siteId}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.context.user?.token}`,
    };
  }
}

class AndonDataSource {
  constructor(private context: Context) {}

  async getAndons(args: any) {
    const params = new URLSearchParams(args);
    const response = await fetch(`http://andon-service:3010/api/v1/andons?${params}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async triggerAndon(input: any) {
    const response = await fetch('http://andon-service:3010/api/v1/andons/trigger', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return response.json();
  }

  async respondAndon(id: string) {
    const response = await fetch(`http://andon-service:3010/api/v1/andons/${id}/respond`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async resolveAndon(id: string, resolution: string) {
    const response = await fetch(`http://andon-service:3010/api/v1/andons/${id}/resolve`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ resolution }),
    });
    return response.json();
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.context.user?.token}`,
    };
  }
}

class TelemetryDataSource {
  constructor(private context: Context) {}

  async getLatestTelemetry(assetId: string) {
    const response = await fetch(`http://early-asset-mgmt-service:3007/api/v1/assets/${assetId}/telemetry/latest`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  async getEvents(assetId: string, limit?: number) {
    const params = new URLSearchParams({ limit: String(limit || 10) });
    const response = await fetch(`http://early-asset-mgmt-service:3007/api/v1/assets/${assetId}/events?${params}`, {
      headers: this.getHeaders(),
    });
    return response.json();
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.context.user?.token}`,
    };
  }
}

export async function createContext({ req }: any): Promise<Context> {
  let user = null;

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const oidcClient = await getOIDCClient();
      const payload = await oidcClient.verifyToken(token);
      user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles || [],
        token,
      };
    } catch (error) {
      logger.warn({ error }, 'Invalid token');
    }
  }

  const context: any = {
    user,
    prisma,
  };

  context.dataSources = {
    masterData: new MasterDataSource(context),
    dms: new DMSDataSource(context),
    analytics: new AnalyticsDataSource(context),
    andon: new AndonDataSource(context),
    telemetry: new TelemetryDataSource(context),
  };

  context.loaders = {
    site: new DataLoader(async (ids: readonly string[]) => {
      const sites = await Promise.all(
        ids.map(id => fetch(`http://master-data-service:3016/api/v1/sites/${id}`, {
          headers: { 'Authorization': `Bearer ${user?.token}` },
        }).then(res => res.json()))
      );
      return sites;
    }),
    line: new DataLoader(async (ids: readonly string[]) => {
      const lines = await Promise.all(
        ids.map(id => fetch(`http://master-data-service:3016/api/v1/lines/${id}`, {
          headers: { 'Authorization': `Bearer ${user?.token}` },
        }).then(res => res.json()))
      );
      return lines;
    }),
    asset: new DataLoader(async (ids: readonly string[]) => {
      const assets = await Promise.all(
        ids.map(id => fetch(`http://master-data-service:3016/api/v1/assets/${id}`, {
          headers: { 'Authorization': `Bearer ${user?.token}` },
        }).then(res => res.json()))
      );
      return assets;
    }),
  };

  return context as Context;
}