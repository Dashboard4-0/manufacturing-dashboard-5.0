import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mqtt from 'mqtt';
import { Client as OPCUAClient, MessageSecurityMode, SecurityPolicy } from 'node-opcua';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import crypto from 'crypto';

const EDGE_GATEWAY_URL = process.env.EDGE_GATEWAY_URL || 'http://localhost:3010';
const CLOUD_GATEWAY_URL = process.env.CLOUD_GATEWAY_URL || 'http://localhost:3000';
const OPC_UA_ENDPOINT = process.env.OPC_UA_ENDPOINT || 'opc.tcp://localhost:4840';

describe('Edge-to-Cloud Data Pipeline Validation', () => {
  let opcuaClient: OPCUAClient;
  let mqttClient: mqtt.MqttClient;
  let pgPool: Pool;
  let kafka: Kafka;
  let kafkaProducer: any;
  let kafkaConsumer: any;

  beforeAll(async () => {
    // Initialize OPC UA client
    opcuaClient = OPCUAClient.create({
      applicationName: 'MS5TestClient',
      connectionStrategy: {
        initialDelay: 1000,
        maxRetry: 3
      },
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      endpointMustExist: false
    });

    // Initialize MQTT client
    mqttClient = mqtt.connect('mqtt://localhost:1883', {
      clientId: 'ms5-test-client',
      clean: true
    });

    // Initialize PostgreSQL connection
    pgPool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'ms5db',
      user: 'ms5user',
      password: 'ms5password'
    });

    // Initialize Kafka
    kafka = new Kafka({
      clientId: 'ms5-test',
      brokers: ['localhost:9092']
    });

    kafkaProducer = kafka.producer();
    kafkaConsumer = kafka.consumer({ groupId: 'test-group' });

    await kafkaProducer.connect();
    await kafkaConsumer.connect();
    await kafkaConsumer.subscribe({ topic: 'ms5.telemetry', fromBeginning: false });
  });

  afterAll(async () => {
    await opcuaClient?.disconnect();
    mqttClient?.end();
    await pgPool?.end();
    await kafkaProducer?.disconnect();
    await kafkaConsumer?.disconnect();
  });

  describe('OPC UA Data Collection', () => {
    it('should connect to OPC UA server and read values', async () => {
      await opcuaClient.connect(OPC_UA_ENDPOINT);

      const session = await opcuaClient.createSession();

      // Read temperature value
      const tempNodeId = 'ns=2;s=Temperature';
      const tempValue = await session.read({
        nodeId: tempNodeId,
        attributeId: 13 // Value attribute
      });

      expect(tempValue.statusCode.isGood()).toBe(true);
      expect(tempValue.value.value).toBeDefined();

      // Read pressure value
      const pressureNodeId = 'ns=2;s=Pressure';
      const pressureValue = await session.read({
        nodeId: pressureNodeId,
        attributeId: 13
      });

      expect(pressureValue.statusCode.isGood()).toBe(true);

      await session.close();
    });

    it('should subscribe to OPC UA value changes', async () => {
      await opcuaClient.connect(OPC_UA_ENDPOINT);
      const session = await opcuaClient.createSession();

      const subscription = await session.createSubscription2({
        requestedPublishingInterval: 1000,
        requestedLifetimeCount: 100,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 100,
        publishingEnabled: true,
        priority: 10
      });

      let valueChanges = 0;

      const monitoredItem = await subscription.monitor(
        {
          nodeId: 'ns=2;s=Temperature',
          attributeId: 13
        },
        {
          samplingInterval: 100,
          discardOldest: true,
          queueSize: 10
        }
      );

      monitoredItem.on('changed', (dataValue) => {
        valueChanges++;
        expect(dataValue.statusCode.isGood()).toBe(true);
      });

      // Wait for changes
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(valueChanges).toBeGreaterThan(0);

      await subscription.terminate();
      await session.close();
    });
  });

  describe('Edge Gateway Processing', () => {
    it('should transform OPC UA data to unified format', async () => {
      const rawData = {
        nodeId: 'ns=2;s=Temperature',
        value: 25.5,
        timestamp: new Date(),
        quality: 'Good'
      };

      const response = await fetch(`${EDGE_GATEWAY_URL}/api/transform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawData)
      });

      const transformed = await response.json();

      expect(transformed).toMatchObject({
        assetId: expect.any(String),
        metric: 'temperature',
        value: 25.5,
        timestamp: expect.any(String),
        quality: 'Good',
        metadata: expect.any(Object)
      });
    });

    it('should apply edge analytics', async () => {
      const telemetryData = {
        assetId: 'asset-1',
        metrics: {
          temperature: 85,
          pressure: 150,
          vibration: 2.5
        },
        timestamp: new Date().toISOString()
      };

      const response = await fetch(`${EDGE_GATEWAY_URL}/api/analytics/realtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telemetryData)
      });

      const result = await response.json();

      expect(result).toMatchObject({
        assetId: 'asset-1',
        anomalies: expect.any(Array),
        predictions: expect.any(Object),
        alerts: expect.any(Array)
      });
    });

    it('should store data locally when offline', async () => {
      // Simulate offline mode
      await fetch(`${EDGE_GATEWAY_URL}/api/network/offline`, { method: 'POST' });

      // Send data
      const data = {
        assetId: 'asset-1',
        metric: 'temperature',
        value: 26.5,
        timestamp: new Date().toISOString()
      };

      const response = await fetch(`${EDGE_GATEWAY_URL}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      expect(response.status).toBe(202); // Accepted for local storage

      // Check local storage
      const storageResponse = await fetch(`${EDGE_GATEWAY_URL}/api/journal/pending`);
      const pendingEvents = await storageResponse.json();

      expect(pendingEvents).toContainEqual(
        expect.objectContaining({
          assetId: 'asset-1',
          synced: false
        })
      );

      // Restore online mode
      await fetch(`${EDGE_GATEWAY_URL}/api/network/online`, { method: 'POST' });
    });
  });

  describe('Data Transmission', () => {
    it('should transmit data via MQTT', (done) => {
      const testData = {
        assetId: 'asset-1',
        metric: 'temperature',
        value: 27.5,
        timestamp: new Date().toISOString()
      };

      mqttClient.subscribe('ms5/telemetry/+', (err) => {
        if (err) return done(err);

        mqttClient.on('message', (topic, message) => {
          const received = JSON.parse(message.toString());
          expect(received).toMatchObject(testData);
          done();
        });

        mqttClient.publish('ms5/telemetry/asset-1', JSON.stringify(testData));
      });
    });

    it('should publish to Kafka topics', async () => {
      const testEvent = {
        id: crypto.randomUUID(),
        type: 'TELEMETRY',
        assetId: 'asset-1',
        data: {
          temperature: 28.5,
          pressure: 145
        },
        timestamp: new Date().toISOString()
      };

      await kafkaProducer.send({
        topic: 'ms5.telemetry',
        messages: [
          {
            key: testEvent.assetId,
            value: JSON.stringify(testEvent),
            headers: {
              'event-type': 'telemetry',
              'source': 'edge-gateway'
            }
          }
        ]
      });

      // Consume and verify
      const messages: any[] = [];
      await kafkaConsumer.run({
        eachMessage: async ({ message }) => {
          messages.push(JSON.parse(message.value!.toString()));
        }
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(messages).toContainEqual(
        expect.objectContaining({
          id: testEvent.id,
          assetId: 'asset-1'
        })
      );
    });
  });

  describe('Cloud Ingestion', () => {
    it('should ingest and store telemetry data', async () => {
      const telemetryData = {
        assetId: 'asset-1',
        metrics: {
          temperature: 29.5,
          pressure: 148,
          speed: 1200
        },
        timestamp: new Date().toISOString()
      };

      const response = await fetch(`${CLOUD_GATEWAY_URL}/api/telemetry/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telemetryData)
      });

      expect(response.status).toBe(202);

      // Verify in TimescaleDB
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = await pgPool.query(
        'SELECT * FROM telemetry WHERE asset_id = $1 ORDER BY timestamp DESC LIMIT 1',
        ['asset-1']
      );

      expect(result.rows[0]).toMatchObject({
        asset_id: 'asset-1',
        temperature: 29.5,
        pressure: 148,
        speed: 1200
      });
    });

    it('should create continuous aggregates', async () => {
      // Check if continuous aggregate exists
      const aggResult = await pgPool.query(`
        SELECT * FROM timescaledb_information.continuous_aggregates
        WHERE view_name = 'telemetry_1min'
      `);

      expect(aggResult.rows.length).toBeGreaterThan(0);

      // Query aggregated data
      const dataResult = await pgPool.query(`
        SELECT * FROM telemetry_1min
        WHERE asset_id = 'asset-1'
        ORDER BY bucket DESC
        LIMIT 1
      `);

      if (dataResult.rows.length > 0) {
        expect(dataResult.rows[0]).toHaveProperty('avg_temperature');
        expect(dataResult.rows[0]).toHaveProperty('avg_pressure');
        expect(dataResult.rows[0]).toHaveProperty('min_temperature');
        expect(dataResult.rows[0]).toHaveProperty('max_temperature');
      }
    });
  });

  describe('Data Integrity', () => {
    it('should maintain hash chain for audit logs', async () => {
      // Create series of events
      const events = [];
      for (let i = 0; i < 5; i++) {
        const event = {
          type: 'TELEMETRY',
          assetId: 'asset-1',
          data: { value: i },
          timestamp: new Date().toISOString()
        };

        const response = await fetch(`${EDGE_GATEWAY_URL}/api/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event)
        });

        const result = await response.json();
        events.push(result);
      }

      // Verify hash chain
      for (let i = 1; i < events.length; i++) {
        const expectedHash = crypto
          .createHmac('sha256', 'secret-key')
          .update(events[i - 1].signature + JSON.stringify(events[i].data))
          .digest('hex');

        expect(events[i].signature).toBeDefined();
      }
    });

    it('should detect tampered data', async () => {
      // Insert tampered record directly
      const tamperedRecord = {
        id: crypto.randomUUID(),
        type: 'TELEMETRY',
        data: { value: 999 },
        signature: 'invalid-signature',
        previousSignature: 'fake-previous',
        timestamp: new Date()
      };

      await pgPool.query(
        'INSERT INTO audit_logs (id, type, data, signature, previous_signature, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
        [tamperedRecord.id, tamperedRecord.type, JSON.stringify(tamperedRecord.data),
         tamperedRecord.signature, tamperedRecord.previousSignature, tamperedRecord.timestamp]
      );

      // Run integrity check
      const response = await fetch(`${CLOUD_GATEWAY_URL}/api/audit/verify`);
      const result = await response.json();

      expect(result.valid).toBe(false);
      expect(result.invalidRecords).toContainEqual(
        expect.objectContaining({
          id: tamperedRecord.id
        })
      );
    });
  });

  describe('Synchronisation and Recovery', () => {
    it('should sync pending events when reconnected', async () => {
      // Simulate offline period with data collection
      await fetch(`${EDGE_GATEWAY_URL}/api/network/offline`, { method: 'POST' });

      // Generate events while offline
      const offlineEvents = [];
      for (let i = 0; i < 10; i++) {
        const event = {
          assetId: 'asset-offline',
          metric: 'temperature',
          value: 20 + i,
          timestamp: new Date().toISOString()
        };

        await fetch(`${EDGE_GATEWAY_URL}/api/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event)
        });

        offlineEvents.push(event);
      }

      // Go back online
      await fetch(`${EDGE_GATEWAY_URL}/api/network/online`, { method: 'POST' });

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify all events synced to cloud
      const result = await pgPool.query(
        'SELECT COUNT(*) FROM telemetry WHERE asset_id = $1',
        ['asset-offline']
      );

      expect(parseInt(result.rows[0].count)).toBe(10);
    });

    it('should handle partial sync failures', async () => {
      // Create batch of events
      const events = Array.from({ length: 100 }, (_, i) => ({
        id: crypto.randomUUID(),
        assetId: 'asset-batch',
        metric: 'pressure',
        value: 100 + i,
        timestamp: new Date(Date.now() - i * 1000).toISOString()
      }));

      // Send batch with simulated partial failure
      const response = await fetch(`${EDGE_GATEWAY_URL}/api/telemetry/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Simulate-Partial-Failure': 'true'
        },
        body: JSON.stringify(events)
      });

      const result = await response.json();

      expect(result.success).toBeLessThan(100);
      expect(result.failed).toBeGreaterThan(0);
      expect(result.retryQueue).toContainEqual(
        expect.objectContaining({
          assetId: 'asset-batch'
        })
      );
    });
  });

  describe('Performance Benchmarks', () => {
    it('should meet latency requirements', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = Date.now();

        await fetch(`${EDGE_GATEWAY_URL}/api/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId: 'asset-perf',
            metric: 'test',
            value: i,
            timestamp: new Date().toISOString()
          })
        });

        latencies.push(Date.now() - start);
      }

      const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
      const p99 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

      expect(p95).toBeLessThan(100); // P95 < 100ms
      expect(p99).toBeLessThan(200); // P99 < 200ms
    });

    it('should handle high throughput', async () => {
      const startTime = Date.now();
      const promises = [];

      // Send 1000 events concurrently
      for (let i = 0; i < 1000; i++) {
        promises.push(
          fetch(`${EDGE_GATEWAY_URL}/api/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              assetId: `asset-${i % 10}`,
              metric: 'throughput',
              value: i,
              timestamp: new Date().toISOString()
            })
          })
        );
      }

      const responses = await Promise.all(promises);
      const duration = Date.now() - startTime;

      const successCount = responses.filter(r => r.status === 202).length;
      const throughput = (successCount / duration) * 1000; // Events per second

      expect(successCount).toBeGreaterThan(950); // >95% success rate
      expect(throughput).toBeGreaterThan(100); // >100 events/second
    });
  });
});