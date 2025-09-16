# MS5.0 Security Guide

## Table of Contents

1. [Security Architecture](#security-architecture)
2. [Authentication & Authorisation](#authentication--authorisation)
3. [Data Protection](#data-protection)
4. [Network Security](#network-security)
5. [Secrets Management](#secrets-management)
6. [Audit Logging](#audit-logging)
7. [Security Monitoring](#security-monitoring)
8. [Incident Response](#incident-response)
9. [Compliance](#compliance)
10. [Security Checklist](#security-checklist)

## Security Architecture

### Defence in Depth Strategy

```
┌─────────────────────────────────────────────────┐
│                   WAF / DDoS                     │
├─────────────────────────────────────────────────┤
│              Load Balancer / TLS                 │
├─────────────────────────────────────────────────┤
│           Ingress Controller / Rate Limiting     │
├─────────────────────────────────────────────────┤
│         Network Policies / Service Mesh          │
├─────────────────────────────────────────────────┤
│      RBAC / OIDC / Service Authentication       │
├─────────────────────────────────────────────────┤
│         Application Security / Validation        │
├─────────────────────────────────────────────────┤
│          Data Encryption / Audit Logs           │
└─────────────────────────────────────────────────┘
```

### Security Principles

- **Zero Trust**: Never trust, always verify
- **Least Privilege**: Minimal required permissions
- **Defence in Depth**: Multiple security layers
- **Fail Secure**: Deny by default
- **Audit Everything**: Comprehensive logging

## Authentication & Authorisation

### OIDC Configuration with Azure AD

#### Environment Variables

```bash
# Required OIDC settings
OIDC_ISSUER=https://login.microsoftonline.com/{tenant-id}/v2.0
OIDC_CLIENT_ID={application-client-id}
OIDC_CLIENT_SECRET={encrypted-in-vault}
OIDC_REDIRECT_URI=https://api.ms5.example.com/auth/callback
```

#### Azure AD App Registration

```bash
# Register application
az ad app create \
  --display-name "MS5 Manufacturing System" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris https://api.ms5.example.com/auth/callback

# Create service principal
az ad sp create --id {app-id}

# Assign roles
az role assignment create \
  --assignee {sp-object-id} \
  --role "Directory Reader"
```

### RBAC Implementation

#### Role Definitions

```typescript
// libs/shared/src/auth/rbac.ts
export const roles = {
  admin: {
    permissions: ['*'],
    description: 'Full system access',
  },
  manager: {
    permissions: [
      'read:*',
      'write:production',
      'write:quality',
      'write:maintenance',
      'execute:reports',
    ],
    description: 'Management access to all production data',
  },
  supervisor: {
    permissions: [
      'read:production',
      'write:production:assigned',
      'read:quality',
      'write:quality:assigned',
      'execute:andon',
    ],
    description: 'Supervise assigned production lines',
  },
  operator: {
    permissions: [
      'read:production:assigned',
      'write:production:basic',
      'execute:andon',
      'read:sqdc',
    ],
    description: 'Operate assigned workstation',
  },
  viewer: {
    permissions: ['read:*'],
    description: 'Read-only access',
  },
};
```

#### Permission Checking

```typescript
// Middleware for permission checking
export const requirePermission = (permission: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorised' });
    }

    const hasPermission = checkPermission(user.role, permission);

    if (!hasPermission) {
      auditLog('PERMISSION_DENIED', permission, user.id, 'DENIED');
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
```

### Multi-Factor Authentication (MFA)

```typescript
// Enable MFA for sensitive operations
const requireMFA = async (req: Request, res: Response, next: NextFunction) => {
  const mfaToken = req.headers['x-mfa-token'];

  if (!mfaToken) {
    return res.status(401).json({
      error: 'MFA required',
      mfaRequired: true,
    });
  }

  const isValid = await verifyMFAToken(req.user.id, mfaToken);

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid MFA token' });
  }

  next();
};
```

## Data Protection

### Encryption at Rest

```yaml
# StorageClass with encryption
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: encrypted-ssd
provisioner: kubernetes.io/azure-disk
parameters:
  storageaccounttype: Premium_LRS
  kind: Managed
  encryption: 'true'
  encryptionType: EncryptionAtRestWithPlatformKey
```

### Encryption in Transit

```yaml
# TLS configuration for services
apiVersion: v1
kind: ConfigMap
metadata:
  name: tls-config
data:
  tls.conf: |
    ssl_protocols TLSv1.3 TLSv1.2;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_stapling on;
    ssl_stapling_verify on;
```

### Database Security

```sql
-- Enable row-level security
ALTER TABLE production_data ENABLE ROW LEVEL SECURITY;

-- Create security policy
CREATE POLICY user_data_policy ON production_data
  FOR ALL
  TO application_user
  USING (user_id = current_user_id());

-- Encrypt sensitive columns
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ALTER COLUMN email TYPE TEXT USING pgp_sym_encrypt(email, 'encryption-key');
```

### API Security Headers

```typescript
// Security headers middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'wss:', 'https:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
```

## Network Security

### Kubernetes Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ms5-gateway-policy
  namespace: ms5
spec:
  podSelector:
    matchLabels:
      app: ms5-gateway
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3000
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - podSelector:
            matchLabels:
              app: redis
      ports:
        - protocol: TCP
          port: 6379
    - to:
        - namespaceSelector:
            matchLabels:
              name: ms5
      ports:
        - protocol: TCP
          port: 3001
        - protocol: TCP
          port: 3002
```

### Rate Limiting Configuration

```typescript
// Rate limiting per IP and user
const rateLimiters = {
  global: new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'rl:global',
    points: 1000, // requests
    duration: 60, // per minute
    blockDuration: 60, // block for 1 minute
  }),

  api: new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'rl:api',
    points: 100,
    duration: 60,
    blockDuration: 300,
  }),

  auth: new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'rl:auth',
    points: 5,
    duration: 900, // 15 minutes
    blockDuration: 900,
  }),
};
```

### WAF Rules

```yaml
# Azure Application Gateway WAF configuration
apiVersion: network.azure.com/v1
kind: ApplicationGatewayWebApplicationFirewallPolicy
metadata:
  name: ms5-waf-policy
spec:
  customRules:
    - name: BlockSQLInjection
      priority: 1
      ruleType: MatchRule
      matchConditions:
        - matchVariables:
            - variableName: RequestBody
          operator: Contains
          matchValues:
            - "';--"
            - "' OR 1=1"
            - 'UNION SELECT'
      action: Block
    - name: BlockXSS
      priority: 2
      ruleType: MatchRule
      matchConditions:
        - matchVariables:
            - variableName: RequestBody
          operator: Contains
          matchValues:
            - '<script'
            - 'javascript:'
            - 'onerror='
      action: Block
  managedRules:
    managedRuleSets:
      - ruleSetType: OWASP
        ruleSetVersion: '3.2'
```

## Secrets Management

### HashiCorp Vault Integration

```bash
# Initialize Vault
vault operator init -key-shares=5 -key-threshold=3

# Unseal Vault
vault operator unseal <key-1>
vault operator unseal <key-2>
vault operator unseal <key-3>

# Enable KV secrets engine
vault secrets enable -path=ms5 kv-v2

# Store secrets
vault kv put ms5/database \
  username=ms5user \
  password=$(openssl rand -base64 32)

vault kv put ms5/jwt \
  secret=$(openssl rand -base64 64)

vault kv put ms5/oidc \
  client_secret=${OIDC_CLIENT_SECRET}
```

### Kubernetes Secrets with Sealed Secrets

```bash
# Install Sealed Secrets controller
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.24.0/controller.yaml

# Create sealed secret
echo -n 'mysecret' | kubectl create secret generic db-password \
  --dry-run=client \
  --from-file=password=/dev/stdin \
  -o yaml | kubeseal -o yaml > sealed-secret.yaml

# Apply sealed secret
kubectl apply -f sealed-secret.yaml
```

### Secret Rotation

```bash
#!/bin/bash
# Automated secret rotation script

# Rotate database password
NEW_PASSWORD=$(openssl rand -base64 32)

# Update in Vault
vault kv put ms5/database password=$NEW_PASSWORD

# Update database
kubectl exec -n ms5 postgres-0 -- psql -U postgres \
  -c "ALTER USER ms5user PASSWORD '$NEW_PASSWORD';"

# Restart applications to pick up new password
kubectl rollout restart deployment -n ms5

# Log rotation event
echo "$(date): Database password rotated" >> /var/log/secret-rotation.log
```

## Audit Logging

### Hash-Chained Audit Logs

```typescript
// Tamper-evident audit logging
class AuditLogger {
  private previousHash: string | null = null;

  async log(event: AuditEvent): Promise<void> {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: event.userId,
      action: event.action,
      resource: event.resource,
      result: event.result,
      metadata: event.metadata,
      previousHash: this.previousHash,
    };

    // Calculate hash chain
    const hash = crypto
      .createHmac('sha256', process.env.AUDIT_SIGNING_KEY!)
      .update(JSON.stringify(entry))
      .digest('hex');

    entry.hash = hash;
    this.previousHash = hash;

    // Store in database
    await prisma.auditLog.create({ data: entry });

    // Send to SIEM
    await sendToSIEM(entry);
  }

  async verifyIntegrity(): Promise<boolean> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'asc' },
    });

    let previousHash: string | null = null;

    for (const log of logs) {
      const calculated = crypto
        .createHmac('sha256', process.env.AUDIT_SIGNING_KEY!)
        .update(
          JSON.stringify({
            ...log,
            hash: undefined,
            previousHash,
          }),
        )
        .digest('hex');

      if (calculated !== log.hash) {
        logger.error(`Audit log tampering detected at ${log.id}`);
        return false;
      }

      previousHash = log.hash;
    }

    return true;
  }
}
```

### Security Event Logging

```typescript
// Log security events
export const securityEventLogger = {
  loginAttempt: (email: string, success: boolean, ip: string) => {
    auditLog('LOGIN_ATTEMPT', 'auth', email, success ? 'SUCCESS' : 'FAILURE', { ip });
  },

  permissionDenied: (userId: string, resource: string, action: string) => {
    auditLog('PERMISSION_DENIED', resource, userId, 'DENIED', { action });
  },

  dataAccess: (userId: string, table: string, operation: string, recordId: string) => {
    auditLog('DATA_ACCESS', table, userId, 'SUCCESS', { operation, recordId });
  },

  configChange: (userId: string, setting: string, oldValue: any, newValue: any) => {
    auditLog('CONFIG_CHANGE', setting, userId, 'SUCCESS', { oldValue, newValue });
  },

  suspiciousActivity: (userId: string, activity: string, details: any) => {
    auditLog('SUSPICIOUS_ACTIVITY', 'security', userId, 'ALERT', { activity, details });
  },
};
```

## Security Monitoring

### Prometheus Security Metrics

```typescript
// Custom security metrics
export const securityMetrics = {
  failedLogins: new Counter({
    name: 'ms5_failed_login_attempts_total',
    help: 'Total failed login attempts',
    labelNames: ['reason'],
  }),

  permissionDenials: new Counter({
    name: 'ms5_permission_denials_total',
    help: 'Total permission denial events',
    labelNames: ['resource', 'action'],
  }),

  suspiciousRequests: new Counter({
    name: 'ms5_suspicious_requests_total',
    help: 'Total suspicious requests detected',
    labelNames: ['type'],
  }),

  tokenValidationErrors: new Counter({
    name: 'ms5_token_validation_errors_total',
    help: 'Total JWT validation errors',
    labelNames: ['error_type'],
  }),
};
```

### Alerting Rules

```yaml
# Prometheus alert rules
groups:
  - name: security
    rules:
      - alert: HighFailedLoginRate
        expr: rate(ms5_failed_login_attempts_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: High failed login rate detected
          description: '{{ $value }} failed logins per second'

      - alert: SuspiciousActivity
        expr: rate(ms5_suspicious_requests_total[5m]) > 5
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: Suspicious activity detected
          description: '{{ $value }} suspicious requests per second'

      - alert: AuditLogTampering
        expr: ms5_audit_log_integrity_check == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: Audit log tampering detected
          description: 'Audit log integrity check failed'
```

### SIEM Integration

```typescript
// Send events to SIEM
async function sendToSIEM(event: SecurityEvent): Promise<void> {
  const syslogMessage = {
    facility: 16, // local0
    severity: getSeverity(event.type),
    timestamp: event.timestamp,
    hostname: process.env.HOSTNAME,
    appName: 'ms5',
    procId: process.pid,
    msgId: event.id,
    structuredData: {
      event: event.type,
      user: event.userId,
      resource: event.resource,
      result: event.result,
    },
    message: JSON.stringify(event),
  };

  await syslog.send(syslogMessage);
}
```

## Incident Response

### Incident Response Plan

#### 1. Detection & Analysis

```bash
# Check for active threats
kubectl get events -n ms5 --field-selector type=Warning

# Review security logs
kubectl logs -n ms5 -l app=ms5-gateway --since=1h | grep -E "401|403|DENIED"

# Check for anomalies
curl prometheus:9090/api/v1/query?query=rate(ms5_suspicious_requests_total[5m])
```

#### 2. Containment

```bash
# Isolate affected pod
kubectl label pod <pod-name> quarantine=true -n ms5

# Update network policy to isolate
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: quarantine-policy
  namespace: ms5
spec:
  podSelector:
    matchLabels:
      quarantine: "true"
  policyTypes:
  - Ingress
  - Egress
EOF

# Revoke compromised credentials
vault lease revoke -prefix ms5/
```

#### 3. Eradication

```bash
# Remove malicious artifacts
kubectl delete pod <compromised-pod> -n ms5

# Patch vulnerabilities
kubectl set image deployment/ms5-gateway ms5-gateway=ms5/gateway:patched -n ms5

# Reset secrets
./scripts/rotate-all-secrets.sh
```

#### 4. Recovery

```bash
# Restore from backup if needed
kubectl exec -n ms5 postgres-0 -- pg_restore -d ms5db < backup.dump

# Redeploy clean services
kubectl rollout restart deployment -n ms5

# Verify integrity
./scripts/verify-system-integrity.sh
```

#### 5. Post-Incident

- Document timeline and actions
- Update security controls
- Conduct lessons learned session
- Update incident response procedures

### Security Contacts

| Role             | Contact                  | Responsibility         |
| ---------------- | ------------------------ | ---------------------- |
| Security Officer | security@ms5.example.com | Incident commander     |
| CISO             | ciso@ms5.example.com     | Executive escalation   |
| SOC Team         | soc@ms5.example.com      | 24/7 monitoring        |
| Legal            | legal@ms5.example.com    | Compliance/disclosure  |
| PR Team          | pr@ms5.example.com       | External communication |

## Compliance

### Standards Compliance

- **ISO 27001**: Information Security Management
- **SOC 2 Type II**: Security, Availability, Confidentiality
- **GDPR**: Data privacy and protection
- **NIST Cybersecurity Framework**: Risk management

### Compliance Checks

```bash
# Run compliance scanner
docker run --rm -v $(pwd):/src \
  aquasec/trivy config /src \
  --compliance nist-csf

# Generate compliance report
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: compliance-report
spec:
  template:
    spec:
      containers:
      - name: scanner
        image: ms5/compliance-scanner:latest
        command: ["/scan.sh"]
      restartPolicy: Never
EOF
```

## Security Checklist

### Pre-Deployment

- [ ] All secrets in Vault/Sealed Secrets
- [ ] TLS certificates valid and not expiring
- [ ] Network policies configured
- [ ] RBAC roles and bindings set
- [ ] Security scanning passed
- [ ] Dependency vulnerabilities patched
- [ ] Container images scanned
- [ ] Security headers configured

### Runtime

- [ ] Audit logging enabled
- [ ] Security monitoring active
- [ ] Rate limiting configured
- [ ] WAF rules updated
- [ ] Backup encryption verified
- [ ] Access logs reviewed
- [ ] Intrusion detection active
- [ ] Incident response team ready

### Post-Deployment

- [ ] Penetration test scheduled
- [ ] Security review completed
- [ ] Compliance audit passed
- [ ] Documentation updated
- [ ] Team training completed
- [ ] Disaster recovery tested
- [ ] Security metrics baselined
- [ ] Alerts configured

## Security Tools

### Scanning Tools

```bash
# Vulnerability scanning
trivy image ms5/gateway:latest

# Code analysis
sonarqube-scanner \
  -Dsonar.projectKey=ms5 \
  -Dsonar.sources=. \
  -Dsonar.host.url=https://sonar.ms5.example.com

# Dependency check
npm audit
snyk test

# Infrastructure scanning
terrascan scan -t azure
```

### Monitoring Tools

- **Falco**: Runtime security monitoring
- **Grafana**: Security dashboards
- **Prometheus**: Metrics and alerting
- **ELK Stack**: Log aggregation and analysis
- **Jaeger**: Distributed tracing

## Conclusion

Security is a continuous process, not a destination. Regular reviews, updates, and training are
essential to maintain a robust security posture. All team members are responsible for security and
should follow these guidelines diligently.
