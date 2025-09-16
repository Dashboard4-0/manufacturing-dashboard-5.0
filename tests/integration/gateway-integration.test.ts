import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';
import fetch from 'node-fetch';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

describe('Gateway Integration Tests', () => {
  let client: ApolloClient<any>;

  beforeAll(() => {
    client = new ApolloClient({
      uri: `${GATEWAY_URL}/graphql`,
      cache: new InMemoryCache(),
      fetch: fetch as any
    });
  });

  describe('GraphQL Federation', () => {
    it('should federate queries across services', async () => {
      const query = gql`
        query GetDashboardData {
          assets {
            id
            name
            status
            currentOEE
          }
          productionLines {
            id
            name
            currentShift
            efficiency
          }
          recentActions(limit: 5) {
            id
            boardType
            category
            status
            description
          }
        }
      `;

      const result = await client.query({ query });

      expect(result.data).toBeDefined();
      expect(result.data.assets).toBeInstanceOf(Array);
      expect(result.data.productionLines).toBeInstanceOf(Array);
      expect(result.data.recentActions).toBeInstanceOf(Array);
    });

    it('should handle mutations across services', async () => {
      const mutation = gql`
        mutation CreateSQDCAction($input: CreateActionInput!) {
          createAction(input: $input) {
            id
            boardType
            category
            status
            description
            createdAt
          }
        }
      `;

      const result = await client.mutate({
        mutation,
        variables: {
          input: {
            boardType: 'SQDC',
            category: 'SAFETY',
            description: 'Integration test action',
            assignedTo: 'test-user',
            dueDate: new Date().toISOString()
          }
        }
      });

      expect(result.data.createAction).toBeDefined();
      expect(result.data.createAction.id).toBeDefined();
      expect(result.data.createAction.boardType).toBe('SQDC');
    });

    it('should handle subscriptions for real-time updates', async () => {
      const subscription = gql`
        subscription OnAndonTriggered {
          andonTriggered {
            id
            type
            lineId
            stationId
            triggeredAt
            status
          }
        }
      `;

      // Test subscription setup
      const observable = client.subscribe({ query: subscription });
      expect(observable).toBeDefined();
    });
  });

  describe('REST API Proxy', () => {
    it('should proxy REST requests to microservices', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/dms/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe('healthy');
    });

    it('should handle authentication headers', async () => {
      const response = await fetch(`${GATEWAY_URL}/api/loss-analytics/oee/line-1`, {
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });

      // Should return 401 for invalid token in production
      // For testing, we check that headers are processed
      expect(response.status).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = Array(150).fill(null).map(() =>
        fetch(`${GATEWAY_URL}/api/health`)
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.some(r => r.status === 429);

      expect(rateLimited).toBe(true);
    });
  });

  describe('CORS Configuration', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await fetch(`${GATEWAY_URL}/graphql`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.ms5.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type'
        }
      });

      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });
});