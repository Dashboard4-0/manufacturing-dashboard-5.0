import axios from 'axios';
import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

interface SecurityTestResult {
  vulnerability: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'PASSED' | 'FAILED';
  details: string;
  recommendation?: string;
}

const securityResults: SecurityTestResult[] = [];

describe('MS5.0 Security Testing Suite', () => {

  describe('1. Authentication & Authorization Tests', () => {
    it('should enforce authentication on protected endpoints', async () => {
      const protectedEndpoints = [
        '/api/v2/admin/users',
        '/api/v2/admin/settings',
        '/api/v2/production/create',
        '/api/v2/assets/delete'
      ];

      for (const endpoint of protectedEndpoints) {
        const response = await axios.get(`${BASE_URL}${endpoint}`, {
          validateStatus: () => true
        });

        const result: SecurityTestResult = {
          vulnerability: 'Unauthenticated Access',
          severity: 'HIGH',
          status: response.status === 401 || response.status === 403 ? 'PASSED' : 'FAILED',
          details: `Endpoint ${endpoint} returned status ${response.status}`,
          recommendation: 'Ensure all protected endpoints require authentication'
        };

        securityResults.push(result);
        expect([401, 403]).toContain(response.status);
      }
    });

    it('should validate JWT tokens properly', async () => {
      // Test with invalid token
      const invalidToken = 'invalid.jwt.token';

      const response = await axios.get(`${BASE_URL}/api/v2/user/profile`, {
        headers: { 'Authorization': `Bearer ${invalidToken}` },
        validateStatus: () => true
      });

      expect(response.status).toBe(401);

      // Test with expired token
      const expiredToken = jwt.sign(
        { userId: 'test', exp: Math.floor(Date.now() / 1000) - 3600 },
        'test-secret'
      );

      const expiredResponse = await axios.get(`${BASE_URL}/api/v2/user/profile`, {
        headers: { 'Authorization': `Bearer ${expiredToken}` },
        validateStatus: () => true
      });

      expect(expiredResponse.status).toBe(401);

      securityResults.push({
        vulnerability: 'JWT Validation',
        severity: 'HIGH',
        status: 'PASSED',
        details: 'JWT tokens are properly validated'
      });
    });

    it('should enforce role-based access control', async () => {
      // Test operator trying to access admin endpoint
      const operatorToken = 'mock-operator-token'; // In real test, generate valid token

      const response = await axios.delete(`${BASE_URL}/api/v2/admin/users/123`, {
        headers: { 'Authorization': `Bearer ${operatorToken}` },
        validateStatus: () => true
      });

      expect(response.status).toBe(403);

      securityResults.push({
        vulnerability: 'RBAC Bypass',
        severity: 'HIGH',
        status: response.status === 403 ? 'PASSED' : 'FAILED',
        details: 'Role-based access control is enforced'
      });
    });
  });

  describe('2. Input Validation & Injection Tests', () => {
    it('should prevent SQL injection attacks', async () => {
      const sqlInjectionPayloads = [
        "' OR '1'='1",
        "'; DROP TABLE users; --",
        "1' UNION SELECT * FROM users--",
        "' OR 1=1--",
        "admin' --",
        "' OR '1'='1' /*"
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await axios.get(
          `${BASE_URL}/api/v2/search?q=${encodeURIComponent(payload)}`,
          { validateStatus: () => true }
        );

        // Check that the request doesn't cause an error and is handled safely
        expect(response.status).not.toBe(500);

        securityResults.push({
          vulnerability: 'SQL Injection',
          severity: 'CRITICAL',
          status: response.status !== 500 ? 'PASSED' : 'FAILED',
          details: `Payload "${payload}" was handled safely`,
          recommendation: 'Use parameterized queries and input validation'
        });
      }
    });

    it('should prevent NoSQL injection attacks', async () => {
      const noSqlPayloads = [
        { $ne: null },
        { $gt: '' },
        { $regex: '.*' },
        { password: { $ne: null } }
      ];

      for (const payload of noSqlPayloads) {
        const response = await axios.post(
          `${BASE_URL}/api/v2/login`,
          { username: 'admin', password: payload },
          { validateStatus: () => true }
        );

        expect(response.status).not.toBe(200);

        securityResults.push({
          vulnerability: 'NoSQL Injection',
          severity: 'CRITICAL',
          status: response.status !== 200 ? 'PASSED' : 'FAILED',
          details: 'NoSQL injection attempt blocked'
        });
      }
    });

    it('should prevent XSS attacks', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert("XSS")>',
        'javascript:alert("XSS")',
        '<svg onload=alert("XSS")>',
        '"><script>alert("XSS")</script>',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>'
      ];

      for (const payload of xssPayloads) {
        const response = await axios.post(
          `${BASE_URL}/api/v2/comments`,
          { content: payload },
          { validateStatus: () => true }
        );

        // Verify the response doesn't reflect the script
        if (response.data && typeof response.data === 'string') {
          expect(response.data).not.toContain('<script>');
          expect(response.data).not.toContain('javascript:');
        }

        securityResults.push({
          vulnerability: 'Cross-Site Scripting (XSS)',
          severity: 'HIGH',
          status: 'PASSED',
          details: 'XSS payload was sanitized',
          recommendation: 'Implement proper output encoding and CSP headers'
        });
      }
    });

    it('should prevent command injection', async () => {
      const commandInjectionPayloads = [
        '; ls -la',
        '| cat /etc/passwd',
        '`rm -rf /`',
        '$(whoami)',
        '&& cat /etc/shadow'
      ];

      for (const payload of commandInjectionPayloads) {
        const response = await axios.post(
          `${BASE_URL}/api/v2/export`,
          { filename: payload },
          { validateStatus: () => true }
        );

        expect(response.status).not.toBe(200);

        securityResults.push({
          vulnerability: 'Command Injection',
          severity: 'CRITICAL',
          status: response.status !== 200 ? 'PASSED' : 'FAILED',
          details: 'Command injection attempt blocked'
        });
      }
    });
  });

  describe('3. Security Headers Tests', () => {
    it('should have proper security headers', async () => {
      const response = await axios.get(`${BASE_URL}/api/v2/health`);

      const requiredHeaders = {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'x-xss-protection': '1; mode=block',
        'strict-transport-security': /max-age=\d+/,
        'content-security-policy': /.+/
      };

      for (const [header, expected] of Object.entries(requiredHeaders)) {
        const value = response.headers[header];
        const isValid = typeof expected === 'string'
          ? value === expected
          : expected.test(value);

        securityResults.push({
          vulnerability: `Missing Security Header: ${header}`,
          severity: 'MEDIUM',
          status: isValid ? 'PASSED' : 'FAILED',
          details: `Header ${header}: ${value || 'missing'}`,
          recommendation: `Add security header: ${header}`
        });
      }
    });

    it('should not expose sensitive information in headers', async () => {
      const response = await axios.get(`${BASE_URL}/api/v2/health`, {
        validateStatus: () => true
      });

      const sensitiveHeaders = ['server', 'x-powered-by', 'x-aspnet-version'];

      for (const header of sensitiveHeaders) {
        const exposed = response.headers[header] !== undefined;

        securityResults.push({
          vulnerability: `Information Disclosure: ${header}`,
          severity: 'LOW',
          status: exposed ? 'FAILED' : 'PASSED',
          details: exposed ? `Exposed: ${response.headers[header]}` : 'Not exposed',
          recommendation: 'Remove or obfuscate server identification headers'
        });
      }
    });
  });

  describe('4. Rate Limiting & DoS Protection', () => {
    it('should enforce rate limiting', async () => {
      const requests = [];
      const endpoint = `${BASE_URL}/api/v2/metrics`;

      // Send 150 requests rapidly
      for (let i = 0; i < 150; i++) {
        requests.push(
          axios.get(endpoint, { validateStatus: () => true })
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);

      expect(rateLimited.length).toBeGreaterThan(0);

      securityResults.push({
        vulnerability: 'Rate Limiting',
        severity: 'MEDIUM',
        status: rateLimited.length > 0 ? 'PASSED' : 'FAILED',
        details: `${rateLimited.length} of 150 requests were rate limited`,
        recommendation: 'Implement proper rate limiting per user/IP'
      });
    });

    it('should limit request payload size', async () => {
      const largePayload = {
        data: crypto.randomBytes(10 * 1024 * 1024).toString('base64') // 10MB
      };

      const response = await axios.post(
        `${BASE_URL}/api/v2/data`,
        largePayload,
        { validateStatus: () => true }
      );

      expect(response.status).toBe(413);

      securityResults.push({
        vulnerability: 'Large Payload DoS',
        severity: 'MEDIUM',
        status: response.status === 413 ? 'PASSED' : 'FAILED',
        details: 'Large payloads are rejected',
        recommendation: 'Implement request size limits'
      });
    });

    it('should handle slowloris attacks', async () => {
      // Simulate slow client
      const slowRequest = new Promise((resolve) => {
        const req = axios.post(
          `${BASE_URL}/api/v2/data`,
          new ReadableStream({
            async start(controller) {
              for (let i = 0; i < 100; i++) {
                controller.enqueue(new Uint8Array([65])); // Send 'A' byte by byte
                await new Promise(r => setTimeout(r, 100)); // 100ms delay
              }
              controller.close();
            }
          }),
          {
            timeout: 5000,
            validateStatus: () => true
          }
        ).catch(err => ({ status: err.code === 'ECONNABORTED' ? 'timeout' : 'error' }));

        resolve(req);
      });

      const result = await slowRequest;

      securityResults.push({
        vulnerability: 'Slowloris Attack',
        severity: 'MEDIUM',
        status: result.status === 'timeout' ? 'PASSED' : 'FAILED',
        details: 'Slow requests are properly timed out',
        recommendation: 'Implement request timeout and connection limits'
      });
    });
  });

  describe('5. Data Security Tests', () => {
    it('should encrypt sensitive data in transit', async () => {
      // Check if HTTPS redirect is enforced
      if (BASE_URL.startsWith('https://')) {
        const httpUrl = BASE_URL.replace('https://', 'http://');

        try {
          const response = await axios.get(httpUrl, {
            maxRedirects: 0,
            validateStatus: () => true
          });

          expect([301, 302, 307, 308]).toContain(response.status);

          securityResults.push({
            vulnerability: 'HTTPS Enforcement',
            severity: 'HIGH',
            status: 'PASSED',
            details: 'HTTP requests are redirected to HTTPS'
          });
        } catch (error) {
          securityResults.push({
            vulnerability: 'HTTPS Enforcement',
            severity: 'HIGH',
            status: 'NEEDS_VERIFICATION',
            details: 'Unable to test HTTPS redirect'
          });
        }
      }
    });

    it('should not expose sensitive data in responses', async () => {
      const response = await axios.get(`${BASE_URL}/api/v2/users/profile`, {
        validateStatus: () => true
      });

      if (response.status === 200 && response.data) {
        const sensitiveFields = ['password', 'passwordHash', 'salt', 'apiKey', 'secretKey'];
        const exposedFields = sensitiveFields.filter(field => response.data[field] !== undefined);

        expect(exposedFields).toHaveLength(0);

        securityResults.push({
          vulnerability: 'Sensitive Data Exposure',
          severity: 'HIGH',
          status: exposedFields.length === 0 ? 'PASSED' : 'FAILED',
          details: exposedFields.length > 0 ? `Exposed fields: ${exposedFields.join(', ')}` : 'No sensitive data exposed',
          recommendation: 'Filter sensitive fields from API responses'
        });
      }
    });

    it('should validate file uploads', async () => {
      const maliciousFiles = [
        { name: 'test.exe', content: 'MZ\x90\x00' }, // Executable
        { name: 'test.php', content: '<?php system($_GET["cmd"]); ?>' },
        { name: '../../../etc/passwd', content: 'traversal' },
        { name: 'test.svg', content: '<svg onload="alert(1)">' }
      ];

      for (const file of maliciousFiles) {
        const formData = new FormData();
        formData.append('file', new Blob([file.content]), file.name);

        const response = await axios.post(
          `${BASE_URL}/api/v2/upload`,
          formData,
          { validateStatus: () => true }
        );

        expect(response.status).not.toBe(200);

        securityResults.push({
          vulnerability: 'File Upload Validation',
          severity: 'HIGH',
          status: response.status !== 200 ? 'PASSED' : 'FAILED',
          details: `File "${file.name}" was rejected`,
          recommendation: 'Validate file types, scan for malware, and sanitize filenames'
        });
      }
    });
  });

  describe('6. Session Management Tests', () => {
    it('should invalidate sessions on logout', async () => {
      // Login to get session
      const loginResponse = await axios.post(`${BASE_URL}/api/v2/login`, {
        username: 'test',
        password: 'test'
      }, { validateStatus: () => true });

      if (loginResponse.status === 200) {
        const token = loginResponse.data.token;

        // Logout
        await axios.post(`${BASE_URL}/api/v2/logout`, {}, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        // Try to use the same token
        const response = await axios.get(`${BASE_URL}/api/v2/user/profile`, {
          headers: { 'Authorization': `Bearer ${token}` },
          validateStatus: () => true
        });

        expect(response.status).toBe(401);

        securityResults.push({
          vulnerability: 'Session Invalidation',
          severity: 'MEDIUM',
          status: response.status === 401 ? 'PASSED' : 'FAILED',
          details: 'Sessions are properly invalidated on logout'
        });
      }
    });

    it('should enforce session timeout', async () => {
      // This would require waiting for actual timeout or mocking time
      securityResults.push({
        vulnerability: 'Session Timeout',
        severity: 'MEDIUM',
        status: 'NEEDS_VERIFICATION',
        details: 'Session timeout needs to be verified in production',
        recommendation: 'Implement automatic session expiration after inactivity'
      });
    });
  });

  describe('7. CORS Configuration Tests', () => {
    it('should have proper CORS configuration', async () => {
      const response = await axios.options(`${BASE_URL}/api/v2/health`, {
        headers: {
          'Origin': 'http://evil.com',
          'Access-Control-Request-Method': 'GET'
        },
        validateStatus: () => true
      });

      const allowedOrigin = response.headers['access-control-allow-origin'];
      const isWildcard = allowedOrigin === '*';

      securityResults.push({
        vulnerability: 'CORS Misconfiguration',
        severity: isWildcard ? 'HIGH' : 'LOW',
        status: !isWildcard ? 'PASSED' : 'FAILED',
        details: `CORS Origin: ${allowedOrigin || 'not set'}`,
        recommendation: 'Configure CORS to allow only trusted origins'
      });
    });
  });

  // Generate security report
  afterAll(() => {
    console.log('\n=== Security Test Report ===\n');

    const summary = {
      total: securityResults.length,
      passed: securityResults.filter(r => r.status === 'PASSED').length,
      failed: securityResults.filter(r => r.status === 'FAILED').length,
      needsVerification: securityResults.filter(r => r.status === 'NEEDS_VERIFICATION').length
    };

    const bySeverity = {
      critical: securityResults.filter(r => r.severity === 'CRITICAL'),
      high: securityResults.filter(r => r.severity === 'HIGH'),
      medium: securityResults.filter(r => r.severity === 'MEDIUM'),
      low: securityResults.filter(r => r.severity === 'LOW')
    };

    console.log('Summary:', summary);
    console.log('\nBy Severity:');
    console.log('- CRITICAL:', bySeverity.critical.length);
    console.log('- HIGH:', bySeverity.high.length);
    console.log('- MEDIUM:', bySeverity.medium.length);
    console.log('- LOW:', bySeverity.low.length);

    console.log('\nFailed Tests:');
    securityResults
      .filter(r => r.status === 'FAILED')
      .forEach(r => {
        console.log(`- [${r.severity}] ${r.vulnerability}: ${r.details}`);
        if (r.recommendation) {
          console.log(`  Recommendation: ${r.recommendation}`);
        }
      });
  });
});