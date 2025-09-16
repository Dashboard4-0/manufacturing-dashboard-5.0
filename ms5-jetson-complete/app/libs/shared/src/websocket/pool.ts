import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import crypto from 'crypto';

const logger = createLogger('websocket-pool');

export interface WebSocketPoolConfig {
  maxConnections?: number;
  maxConnectionsPerClient?: number;
  heartbeatInterval?: number;
  reconnectInterval?: number;
  messageQueueSize?: number;
  connectionTimeout?: number;
  enableCompression?: boolean;
  perMessageDeflate?: boolean;
}

export interface PooledConnection {
  id: string;
  ws: WebSocket;
  clientId: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  state: 'connecting' | 'open' | 'closing' | 'closed';
  metadata?: Record<string, any>;
}

export interface ConnectionStats {
  total: number;
  active: number;
  idle: number;
  connecting: number;
  messagesSent: number;
  messagesReceived: number;
  bytesIn: number;
  bytesOut: number;
}

export class WebSocketPool extends EventEmitter {
  private connections = new Map<string, PooledConnection>();
  private clientConnections = new Map<string, Set<string>>();
  private messageQueues = new Map<string, any[]>();
  private stats: ConnectionStats = {
    total: 0,
    active: 0,
    idle: 0,
    connecting: 0,
    messagesSent: 0,
    messagesReceived: 0,
    bytesIn: 0,
    bytesOut: 0
  };
  private heartbeatInterval?: NodeJS.Timer;
  private cleanupInterval?: NodeJS.Timer;

  constructor(private config: Required<WebSocketPoolConfig>) {
    super();
    this.config = {
      maxConnections: config.maxConnections || 1000,
      maxConnectionsPerClient: config.maxConnectionsPerClient || 5,
      heartbeatInterval: config.heartbeatInterval || 30000,
      reconnectInterval: config.reconnectInterval || 5000,
      messageQueueSize: config.messageQueueSize || 100,
      connectionTimeout: config.connectionTimeout || 60000,
      enableCompression: config.enableCompression ?? true,
      perMessageDeflate: config.perMessageDeflate ?? true
    };

    this.startHeartbeat();
    this.startCleanup();
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (connection.state === 'open') {
          this.ping(connection);
        }
      }
    }, this.config.heartbeatInterval);
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.connectionTimeout;

      for (const [id, connection] of this.connections.entries()) {
        const idleTime = now - connection.lastActivity.getTime();
        
        if (idleTime > timeout && connection.state === 'open') {
          logger.info({ connectionId: id, idleTime }, 'Closing idle connection');
          this.closeConnection(id, 1000, 'Idle timeout');
        }
      }

      this.updateStats();
    }, 60000); // Cleanup every minute
  }

  async createConnection(
    url: string,
    clientId: string,
    options: WebSocket.ClientOptions = {}
  ): Promise<PooledConnection> {
    // Check pool limits
    if (this.connections.size >= this.config.maxConnections) {
      throw new Error('Connection pool limit reached');
    }

    // Check per-client limits
    const clientConns = this.clientConnections.get(clientId) || new Set();
    if (clientConns.size >= this.config.maxConnectionsPerClient) {
      throw new Error(`Client ${clientId} has reached connection limit`);
    }

    const connectionId = crypto.randomBytes(16).toString('hex');
    const ws = new WebSocket(url, {
      ...options,
      perMessageDeflate: this.config.perMessageDeflate
    });

    const connection: PooledConnection = {
      id: connectionId,
      ws,
      clientId,
      createdAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      state: 'connecting'
    };

    // Setup event handlers
    this.setupConnectionHandlers(connection);

    // Add to pool
    this.connections.set(connectionId, connection);
    clientConns.add(connectionId);
    this.clientConnections.set(clientId, clientConns);

    // Wait for connection to open
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.closeConnection(connectionId, 1006, 'Connection timeout');
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout);

      ws.once('open', () => {
        clearTimeout(timeout);
        connection.state = 'open';
        this.stats.total++;
        this.stats.active++;
        logger.info({ connectionId, clientId }, 'WebSocket connection established');
        resolve(connection);
      });

      ws.once('error', (error) => {
        clearTimeout(timeout);
        logger.error({ error, connectionId }, 'WebSocket connection error');
        this.removeConnection(connectionId);
        reject(error);
      });
    });
  }

  private setupConnectionHandlers(connection: PooledConnection): void {
    const { ws, id } = connection;

    ws.on('message', (data, isBinary) => {
      connection.lastActivity = new Date();
      connection.messageCount++;
      this.stats.messagesReceived++;
      this.stats.bytesIn += data.length;

      this.emit('message', {
        connectionId: id,
        clientId: connection.clientId,
        data,
        isBinary
      });

      // Process queued messages if any
      this.processMessageQueue(id);
    });

    ws.on('pong', () => {
      connection.lastActivity = new Date();
      logger.debug({ connectionId: id }, 'Pong received');
    });

    ws.on('close', (code, reason) => {
      connection.state = 'closed';
      logger.info({
        connectionId: id,
        code,
        reason: reason?.toString()
      }, 'WebSocket connection closed');
      
      this.emit('close', {
        connectionId: id,
        clientId: connection.clientId,
        code,
        reason
      });

      // Attempt reconnection if appropriate
      if (code !== 1000 && code !== 1001) {
        this.scheduleReconnection(connection);
      } else {
        this.removeConnection(id);
      }
    });

    ws.on('error', (error) => {
      logger.error({ error, connectionId: id }, 'WebSocket error');
      this.emit('error', {
        connectionId: id,
        clientId: connection.clientId,
        error
      });
    });
  }

  private ping(connection: PooledConnection): void {
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.ping();
    }
  }

  private scheduleReconnection(connection: PooledConnection): void {
    setTimeout(() => {
      if (this.connections.has(connection.id)) {
        logger.info({
          connectionId: connection.id,
          clientId: connection.clientId
        }, 'Attempting reconnection');
        
        // Reconnect logic would go here
        // For now, just remove the connection
        this.removeConnection(connection.id);
      }
    }, this.config.reconnectInterval);
  }

  send(
    connectionId: string,
    data: any,
    options: { binary?: boolean; compress?: boolean } = {}
  ): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn({ connectionId }, 'Connection not found');
      return false;
    }

    if (connection.state !== 'open') {
      // Queue the message
      this.queueMessage(connectionId, data, options);
      return false;
    }

    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      connection.ws.send(payload, {
        binary: options.binary || false,
        compress: options.compress ?? this.config.enableCompression
      });

      this.stats.messagesSent++;
      this.stats.bytesOut += payload.length;
      connection.lastActivity = new Date();

      return true;
    } catch (error) {
      logger.error({ error, connectionId }, 'Error sending message');
      return false;
    }
  }

  broadcast(
    clientId: string,
    data: any,
    options: { binary?: boolean; compress?: boolean } = {}
  ): number {
    const connections = this.clientConnections.get(clientId);
    if (!connections) return 0;

    let sent = 0;
    for (const connectionId of connections) {
      if (this.send(connectionId, data, options)) {
        sent++;
      }
    }

    return sent;
  }

  broadcastAll(
    data: any,
    options: { binary?: boolean; compress?: boolean; filter?: (conn: PooledConnection) => boolean } = {}
  ): number {
    let sent = 0;

    for (const connection of this.connections.values()) {
      if (options.filter && !options.filter(connection)) {
        continue;
      }

      if (this.send(connection.id, data, options)) {
        sent++;
      }
    }

    return sent;
  }

  private queueMessage(
    connectionId: string,
    data: any,
    options: any
  ): void {
    let queue = this.messageQueues.get(connectionId);
    if (!queue) {
      queue = [];
      this.messageQueues.set(connectionId, queue);
    }

    if (queue.length >= this.config.messageQueueSize) {
      queue.shift(); // Remove oldest message
    }

    queue.push({ data, options, timestamp: Date.now() });
  }

  private processMessageQueue(connectionId: string): void {
    const queue = this.messageQueues.get(connectionId);
    if (!queue || queue.length === 0) return;

    const connection = this.connections.get(connectionId);
    if (!connection || connection.state !== 'open') return;

    while (queue.length > 0) {
      const message = queue.shift();
      this.send(connectionId, message.data, message.options);
    }

    this.messageQueues.delete(connectionId);
  }

  closeConnection(
    connectionId: string,
    code?: number,
    reason?: string
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.state = 'closing';
    connection.ws.close(code || 1000, reason);
    this.removeConnection(connectionId);
  }

  private removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Remove from client connections
    const clientConns = this.clientConnections.get(connection.clientId);
    if (clientConns) {
      clientConns.delete(connectionId);
      if (clientConns.size === 0) {
        this.clientConnections.delete(connection.clientId);
      }
    }

    // Remove from pool
    this.connections.delete(connectionId);
    this.messageQueues.delete(connectionId);

    // Update stats
    if (connection.state === 'open') {
      this.stats.active--;
    }
  }

  getConnection(connectionId: string): PooledConnection | undefined {
    return this.connections.get(connectionId);
  }

  getClientConnections(clientId: string): PooledConnection[] {
    const connectionIds = this.clientConnections.get(clientId);
    if (!connectionIds) return [];

    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter(conn => conn !== undefined) as PooledConnection[];
  }

  private updateStats(): void {
    this.stats.total = this.connections.size;
    this.stats.active = 0;
    this.stats.idle = 0;
    this.stats.connecting = 0;

    const now = Date.now();
    for (const connection of this.connections.values()) {
      switch (connection.state) {
        case 'open':
          if (now - connection.lastActivity.getTime() > 60000) {
            this.stats.idle++;
          } else {
            this.stats.active++;
          }
          break;
        case 'connecting':
          this.stats.connecting++;
          break;
      }
    }
  }

  getStats(): ConnectionStats {
    this.updateStats();
    return { ...this.stats };
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket pool');

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    const closePromises: Promise<void>[] = [];
    for (const connection of this.connections.values()) {
      closePromises.push(new Promise(resolve => {
        connection.ws.close(1001, 'Server shutdown');
        connection.ws.once('close', () => resolve());
      }));
    }

    await Promise.all(closePromises);
    this.connections.clear();
    this.clientConnections.clear();
    this.messageQueues.clear();

    logger.info('WebSocket pool shut down complete');
  }
}

// Singleton instance
let wsPool: WebSocketPool | null = null;

export function initializeWebSocketPool(config?: WebSocketPoolConfig): WebSocketPool {
  if (!wsPool) {
    wsPool = new WebSocketPool(config as Required<WebSocketPoolConfig>);
  }
  return wsPool;
}

export function getWebSocketPool(): WebSocketPool {
  if (!wsPool) {
    throw new Error('WebSocket pool not initialized');
  }
  return wsPool;
}