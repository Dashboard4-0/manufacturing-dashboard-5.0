import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  ClientSession,
  ClientSubscription,
  DataValue,
  StatusCodes,
  NodeId,
  AttributeIds
} from 'node-opcua';
import { OPCUAService } from '../client';
import { EventEmitter } from 'events';

// Mock node-opcua
vi.mock('node-opcua', () => {
  const mockSession = {
    read: vi.fn(),
    write: vi.fn(),
    browse: vi.fn(),
    call: vi.fn(),
    createSubscription2: vi.fn(),
    close: vi.fn()
  };

  const mockClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    createSession: vi.fn(() => Promise.resolve(mockSession)),
    on: vi.fn()
  };

  return {
    OPCUAClient: {
      create: vi.fn(() => mockClient)
    },
    MessageSecurityMode: {
      None: 'None',
      Sign: 'Sign',
      SignAndEncrypt: 'SignAndEncrypt'
    },
    SecurityPolicy: {
      None: 'None',
      Basic256Sha256: 'Basic256Sha256'
    },
    StatusCodes: {
      Good: { value: 0, name: 'Good', description: 'Good' },
      Bad: { value: 1, name: 'Bad', description: 'Bad' },
      BadNodeIdUnknown: { value: 2, name: 'BadNodeIdUnknown' },
      BadTimeout: { value: 3, name: 'BadTimeout' }
    },
    AttributeIds: {
      Value: 13,
      NodeClass: 2,
      BrowseName: 3
    },
    DataType: {
      Double: 11,
      Float: 10,
      Int32: 6,
      Boolean: 1,
      String: 12
    }
  };
});

describe('OPC UA Client Service', () => {
  let opcuaService: OPCUAService;
  let mockClient: any;
  let mockSession: any;
  let mockSubscription: any;

  beforeEach(() => {
    opcuaService = new OPCUAService();
    mockClient = (OPCUAClient.create as any).mock.results[0].value;
    mockSession = null;
    mockSubscription = {
      on: vi.fn(),
      monitor: vi.fn(),
      terminate: vi.fn()
    };

    // Setup default mock behaviors
    mockClient.createSession.mockImplementation(async () => {
      mockSession = {
        read: vi.fn(),
        write: vi.fn(),
        browse: vi.fn(),
        call: vi.fn(),
        createSubscription2: vi.fn(() => Promise.resolve(mockSubscription)),
        close: vi.fn()
      };
      return mockSession;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should connect to OPC UA server', async () => {
      mockClient.connect.mockResolvedValue(undefined);

      await opcuaService.connect('opc.tcp://localhost:4840');

      expect(mockClient.connect).toHaveBeenCalledWith('opc.tcp://localhost:4840');
      expect(mockClient.createSession).toHaveBeenCalled();
    });

    it('should handle connection failures', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection refused'));

      await expect(
        opcuaService.connect('opc.tcp://invalid:4840')
      ).rejects.toThrow('Connection refused');
    });

    it('should reconnect on connection loss', async () => {
      const reconnectSpy = vi.spyOn(opcuaService as any, 'reconnect');
      mockClient.connect.mockResolvedValue(undefined);

      await opcuaService.connect('opc.tcp://localhost:4840');

      // Simulate connection loss
      const onCloseCallback = mockClient.on.mock.calls.find(
        call => call[0] === 'close'
      )?.[1];

      if (onCloseCallback) {
        onCloseCallback();
      }

      // Wait for reconnection attempt
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(reconnectSpy).toHaveBeenCalled();
    });

    it('should disconnect gracefully', async () => {
      mockClient.connect.mockResolvedValue(undefined);
      mockClient.disconnect.mockResolvedValue(undefined);

      await opcuaService.connect('opc.tcp://localhost:4840');
      await opcuaService.disconnect();

      expect(mockSession.close).toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      await expect(opcuaService.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Reading Values', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should read single node value', async () => {
      const mockValue = {
        statusCode: StatusCodes.Good,
        value: { value: 25.5, dataType: 'Double' },
        sourceTimestamp: new Date(),
        serverTimestamp: new Date()
      };

      mockSession.read.mockResolvedValue(mockValue);

      const result = await opcuaService.readValue('ns=2;s=Temperature');

      expect(mockSession.read).toHaveBeenCalledWith({
        nodeId: 'ns=2;s=Temperature',
        attributeId: AttributeIds.Value
      });
      expect(result).toEqual({
        nodeId: 'ns=2;s=Temperature',
        value: 25.5,
        quality: 'Good',
        timestamp: mockValue.sourceTimestamp
      });
    });

    it('should read multiple node values', async () => {
      const mockValues = [
        {
          statusCode: StatusCodes.Good,
          value: { value: 25.5 },
          sourceTimestamp: new Date()
        },
        {
          statusCode: StatusCodes.Good,
          value: { value: 150.2 },
          sourceTimestamp: new Date()
        }
      ];

      mockSession.read.mockImplementation((nodes) => {
        if (Array.isArray(nodes)) {
          return Promise.resolve(mockValues);
        }
        return Promise.resolve(mockValues[0]);
      });

      const nodeIds = ['ns=2;s=Temperature', 'ns=2;s=Pressure'];
      const results = await opcuaService.readValues(nodeIds);

      expect(results).toHaveLength(2);
      expect(results[0].value).toBe(25.5);
      expect(results[1].value).toBe(150.2);
    });

    it('should handle read errors', async () => {
      mockSession.read.mockResolvedValue({
        statusCode: StatusCodes.BadNodeIdUnknown,
        value: null
      });

      const result = await opcuaService.readValue('ns=2;s=InvalidNode');

      expect(result.quality).toBe('Bad');
      expect(result.value).toBeNull();
    });

    it('should handle timeout errors', async () => {
      mockSession.read.mockRejectedValue(new Error('Request timeout'));

      await expect(
        opcuaService.readValue('ns=2;s=Temperature')
      ).rejects.toThrow('Request timeout');
    });
  });

  describe('Writing Values', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should write single value', async () => {
      mockSession.write.mockResolvedValue({
        statusCode: StatusCodes.Good
      });

      const result = await opcuaService.writeValue('ns=2;s=SetPoint', 75.0);

      expect(mockSession.write).toHaveBeenCalledWith({
        nodeId: 'ns=2;s=SetPoint',
        attributeId: AttributeIds.Value,
        value: {
          value: {
            dataType: expect.any(Number),
            value: 75.0
          }
        }
      });
      expect(result).toBe(true);
    });

    it('should handle write failures', async () => {
      mockSession.write.mockResolvedValue({
        statusCode: StatusCodes.BadNodeIdUnknown
      });

      const result = await opcuaService.writeValue('ns=2;s=InvalidNode', 100);

      expect(result).toBe(false);
    });

    it('should write multiple values', async () => {
      mockSession.write.mockResolvedValue([
        { statusCode: StatusCodes.Good },
        { statusCode: StatusCodes.Good }
      ]);

      const writes = [
        { nodeId: 'ns=2;s=SetPoint1', value: 50 },
        { nodeId: 'ns=2;s=SetPoint2', value: 75 }
      ];

      const results = await opcuaService.writeValues(writes);

      expect(results).toEqual([true, true]);
    });
  });

  describe('Browsing', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should browse node children', async () => {
      const mockBrowseResult = {
        references: [
          {
            nodeId: { toString: () => 'ns=2;s=Temperature' },
            browseName: { name: 'Temperature' },
            nodeClass: 2,
            typeDefinition: 'AnalogItemType'
          },
          {
            nodeId: { toString: () => 'ns=2;s=Pressure' },
            browseName: { name: 'Pressure' },
            nodeClass: 2,
            typeDefinition: 'AnalogItemType'
          }
        ]
      };

      mockSession.browse.mockResolvedValue(mockBrowseResult);

      const result = await opcuaService.browse('ns=2;s=Device1');

      expect(mockSession.browse).toHaveBeenCalledWith('ns=2;s=Device1');
      expect(result).toHaveLength(2);
      expect(result[0].nodeId).toBe('ns=2;s=Temperature');
      expect(result[0].displayName).toBe('Temperature');
    });

    it('should handle browse errors', async () => {
      mockSession.browse.mockRejectedValue(new Error('Browse failed'));

      await expect(
        opcuaService.browse('ns=2;s=InvalidNode')
      ).rejects.toThrow('Browse failed');
    });
  });

  describe('Subscriptions', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should create subscription and monitor items', async () => {
      const mockMonitoredItem = {
        on: vi.fn()
      };

      mockSubscription.monitor.mockResolvedValue(mockMonitoredItem);

      const callback = vi.fn();
      await opcuaService.subscribe('ns=2;s=Temperature', callback);

      expect(mockSession.createSubscription2).toHaveBeenCalledWith({
        requestedPublishingInterval: 1000,
        requestedLifetimeCount: 100,
        requestedMaxKeepAliveCount: 10,
        maxNotificationsPerPublish: 100,
        publishingEnabled: true,
        priority: 10
      });

      expect(mockSubscription.monitor).toHaveBeenCalledWith(
        {
          nodeId: 'ns=2;s=Temperature',
          attributeId: AttributeIds.Value
        },
        {
          samplingInterval: 1000,
          discardOldest: true,
          queueSize: 10
        }
      );

      // Simulate value change
      const onChangedCallback = mockMonitoredItem.on.mock.calls.find(
        call => call[0] === 'changed'
      )?.[1];

      if (onChangedCallback) {
        onChangedCallback({
          statusCode: StatusCodes.Good,
          value: { value: 26.5 },
          sourceTimestamp: new Date()
        });
      }

      expect(callback).toHaveBeenCalledWith({
        nodeId: 'ns=2;s=Temperature',
        value: 26.5,
        quality: 'Good',
        timestamp: expect.any(Date)
      });
    });

    it('should handle subscription errors', async () => {
      mockSession.createSubscription2.mockRejectedValue(
        new Error('Subscription failed')
      );

      await expect(
        opcuaService.subscribe('ns=2;s=Temperature', vi.fn())
      ).rejects.toThrow('Subscription failed');
    });

    it('should unsubscribe from monitored items', async () => {
      const mockMonitoredItem = {
        on: vi.fn(),
        terminate: vi.fn()
      };

      mockSubscription.monitor.mockResolvedValue(mockMonitoredItem);

      const callback = vi.fn();
      const subscriptionId = await opcuaService.subscribe(
        'ns=2;s=Temperature',
        callback
      );

      await opcuaService.unsubscribe(subscriptionId);

      expect(mockMonitoredItem.terminate).toHaveBeenCalled();
    });
  });

  describe('Method Calls', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should call OPC UA method', async () => {
      const mockResult = {
        statusCode: StatusCodes.Good,
        outputArguments: [{ value: 'Success' }]
      };

      mockSession.call.mockResolvedValue(mockResult);

      const result = await opcuaService.callMethod(
        'ns=2;s=Device1',
        'ns=2;s=StartProcess',
        [100, 'Parameter']
      );

      expect(mockSession.call).toHaveBeenCalledWith({
        objectId: 'ns=2;s=Device1',
        methodId: 'ns=2;s=StartProcess',
        inputArguments: [100, 'Parameter']
      });

      expect(result).toEqual({
        success: true,
        outputs: ['Success']
      });
    });

    it('should handle method call failures', async () => {
      mockSession.call.mockResolvedValue({
        statusCode: StatusCodes.Bad
      });

      const result = await opcuaService.callMethod(
        'ns=2;s=Device1',
        'ns=2;s=InvalidMethod'
      );

      expect(result.success).toBe(false);
    });
  });

  describe('Data Transformation', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should transform OPC UA data to unified format', () => {
      const opcuaData = {
        nodeId: 'ns=2;s=Temperature',
        value: 25.5,
        quality: 'Good',
        timestamp: new Date('2025-01-15T10:30:00Z')
      };

      const transformed = opcuaService.transformData(opcuaData);

      expect(transformed).toEqual({
        assetId: expect.any(String),
        metric: 'temperature',
        value: 25.5,
        quality: 'Good',
        timestamp: '2025-01-15T10:30:00.000Z',
        metadata: {
          nodeId: 'ns=2;s=Temperature',
          source: 'opcua'
        }
      });
    });

    it('should map node IDs to asset tags', () => {
      opcuaService.setTagMapping({
        'ns=2;s=Temperature': 'asset-1.temperature',
        'ns=2;s=Pressure': 'asset-1.pressure',
        'ns=2;s=Speed': 'asset-2.speed'
      });

      const result = opcuaService.getAssetFromNodeId('ns=2;s=Temperature');

      expect(result).toEqual({
        assetId: 'asset-1',
        metric: 'temperature'
      });
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should retry failed operations', async () => {
      mockSession.read
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          statusCode: StatusCodes.Good,
          value: { value: 25.5 },
          sourceTimestamp: new Date()
        });

      const result = await opcuaService.readValueWithRetry('ns=2;s=Temperature', 3);

      expect(result.value).toBe(25.5);
      expect(mockSession.read).toHaveBeenCalledTimes(2);
    });

    it('should give up after max retries', async () => {
      mockSession.read.mockRejectedValue(new Error('Persistent failure'));

      await expect(
        opcuaService.readValueWithRetry('ns=2;s=Temperature', 3)
      ).rejects.toThrow('Persistent failure');

      expect(mockSession.read).toHaveBeenCalledTimes(3);
    });

    it('should handle session timeout and recreate', async () => {
      // First session times out
      mockSession.read.mockRejectedValueOnce(new Error('Session timeout'));

      // New session works
      const newMockSession = {
        read: vi.fn().mockResolvedValue({
          statusCode: StatusCodes.Good,
          value: { value: 30.5 },
          sourceTimestamp: new Date()
        })
      };

      mockClient.createSession.mockResolvedValueOnce(newMockSession);

      const result = await opcuaService.readValue('ns=2;s=Temperature');

      expect(result.value).toBe(30.5);
      expect(mockClient.createSession).toHaveBeenCalledTimes(2); // Initial + recreate
    });
  });

  describe('Performance Monitoring', () => {
    beforeEach(async () => {
      mockClient.connect.mockResolvedValue(undefined);
      await opcuaService.connect('opc.tcp://localhost:4840');
    });

    it('should track operation metrics', async () => {
      mockSession.read.mockResolvedValue({
        statusCode: StatusCodes.Good,
        value: { value: 25.5 },
        sourceTimestamp: new Date()
      });

      const metricsSpy = vi.spyOn(opcuaService as any, 'recordMetric');

      await opcuaService.readValue('ns=2;s=Temperature');

      expect(metricsSpy).toHaveBeenCalledWith(
        'read',
        expect.any(Number),
        true
      );
    });

    it('should track subscription statistics', async () => {
      const stats = opcuaService.getSubscriptionStats();

      expect(stats).toEqual({
        activeSubscriptions: expect.any(Number),
        totalValueChanges: expect.any(Number),
        averageUpdateRate: expect.any(Number)
      });
    });
  });

  describe('Security', () => {
    it('should connect with security settings', async () => {
      const secureService = new OPCUAService({
        securityMode: MessageSecurityMode.SignAndEncrypt,
        securityPolicy: SecurityPolicy.Basic256Sha256,
        certificateFile: '/path/to/cert.pem',
        privateKeyFile: '/path/to/key.pem'
      });

      mockClient.connect.mockResolvedValue(undefined);

      await secureService.connect('opc.tcp://secure-server:4840');

      expect(OPCUAClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          securityMode: MessageSecurityMode.SignAndEncrypt,
          securityPolicy: SecurityPolicy.Basic256Sha256
        })
      );
    });

    it('should validate server certificate', async () => {
      const validateCertSpy = vi.spyOn(
        opcuaService as any,
        'validateServerCertificate'
      );

      mockClient.connect.mockResolvedValue(undefined);

      await opcuaService.connect('opc.tcp://localhost:4840');

      // Certificate validation should be called during connection
      expect(validateCertSpy).toHaveBeenCalled();
    });
  });
});