import {
  OPCUAClient,
  ClientSession,
  ClientSubscription,
  AttributeIds,
  DataValue,
  NodeId,
  TimestampsToReturn,
  MonitoringParametersOptions,
  ClientMonitoredItem,
  MessageSecurityMode,
  SecurityPolicy,
} from 'node-opcua';
import { createLogger } from '@ms5/shared/logger';
import { JournalService } from '../journal/store';
import tagMap from './tag-map.json';

const logger = createLogger('opcua-client');

interface TagMapping {
  nodeId: string;
  assetId: string;
  metricName: string;
  scaleFactor?: number;
  unit?: string;
}

export class OPCUAService {
  private client: OPCUAClient;
  private session: ClientSession | null = null;
  private subscription: ClientSubscription | null = null;
  private journal: JournalService;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

  constructor(journal: JournalService) {
    this.journal = journal;

    const connectionStrategy = {
      initialDelay: 1000,
      maxRetry: 10,
      maxDelay: 10000,
    };

    this.client = OPCUAClient.create({
      applicationName: 'MS5EdgeGateway',
      connectionStrategy,
      securityMode: MessageSecurityMode.SignAndEncrypt,
      securityPolicy: SecurityPolicy.Basic256Sha256,
      endpointMustExist: false,
      keepSessionAlive: true,
      requestedSessionTimeout: 60000,
    });

    this.client.on('connection_lost', () => {
      logger.warn('OPC UA connection lost');
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.client.on('connection_reestablished', () => {
      logger.info('OPC UA connection reestablished');
      this.isConnected = true;
    });
  }

  async connect(): Promise<void> {
    const endpointUrl = process.env.OPCUA_ENDPOINT || 'opc.tcp://localhost:4840';

    try {
      await this.client.connect(endpointUrl);
      logger.info({ endpointUrl }, 'Connected to OPC UA server');

      this.session = await this.client.createSession();
      logger.info('OPC UA session created');

      await this.setupSubscriptions();
      this.isConnected = true;

    } catch (error) {
      logger.error({ error }, 'Failed to connect to OPC UA server');
      this.scheduleReconnect();
      throw error;
    }
  }

  private async setupSubscriptions(): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    this.subscription = await this.session.createSubscription2({
      requestedPublishingInterval: 1000,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 10,
    });

    logger.info('OPC UA subscription created');

    // Subscribe to tags from mapping
    for (const tag of tagMap.tags as TagMapping[]) {
      await this.monitorTag(tag);
    }
  }

  private async monitorTag(tag: TagMapping): Promise<void> {
    if (!this.subscription) {
      throw new Error('No active subscription');
    }

    const itemToMonitor = {
      nodeId: NodeId.resolveNodeId(tag.nodeId),
      attributeId: AttributeIds.Value,
    };

    const parameters: MonitoringParametersOptions = {
      samplingInterval: 1000,
      discardOldest: true,
      queueSize: 10,
    };

    const monitoredItem = ClientMonitoredItem.create(
      this.subscription,
      itemToMonitor,
      parameters,
      TimestampsToReturn.Both,
    );

    monitoredItem.on('changed', (dataValue: DataValue) => {
      this.handleDataChange(tag, dataValue);
    });

    await monitoredItem.on('initialized', () => {
      logger.debug({ nodeId: tag.nodeId }, 'Monitoring initialized');
    });
  }

  private async handleDataChange(tag: TagMapping, dataValue: DataValue): Promise<void> {
    try {
      let value = dataValue.value?.value;

      // Apply scale factor if defined
      if (tag.scaleFactor && typeof value === 'number') {
        value = value * tag.scaleFactor;
      }

      const event = {
        eventId: crypto.randomUUID(),
        timestamp: dataValue.sourceTimestamp || new Date(),
        assetId: tag.assetId,
        type: 'telemetry',
        data: {
          [tag.metricName]: value,
          quality: dataValue.statusCode?.value || 0,
          unit: tag.unit,
        },
      };

      // Store in journal for reliable delivery
      await this.journal.addEvent(event);

      logger.debug(
        { assetId: tag.assetId, metric: tag.metricName, value },
        'Telemetry received',
      );

    } catch (error) {
      logger.error({ error, tag }, 'Failed to process data change');
    }
  }

  async readValue(nodeId: string): Promise<any> {
    if (!this.session) {
      throw new Error('No active session');
    }

    const dataValue = await this.session.read({
      nodeId: nodeId,
      attributeId: AttributeIds.Value,
    });

    return dataValue.value?.value;
  }

  async writeValue(nodeId: string, value: any): Promise<void> {
    if (!this.session) {
      throw new Error('No active session');
    }

    await this.session.write({
      nodeId: nodeId,
      attributeId: AttributeIds.Value,
      value: {
        value: {
          dataType: 11, // Double
          value: value,
        },
      },
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        logger.error({ error }, 'Reconnection failed');
      }
    }, 5000);
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.subscription) {
      await this.subscription.terminate();
      this.subscription = null;
    }

    if (this.session) {
      await this.session.close();
      this.session = null;
    }

    await this.client.disconnect();
    this.isConnected = false;
    logger.info('OPC UA client disconnected');
  }

  isHealthy(): boolean {
    return this.isConnected && this.session !== null;
  }
}