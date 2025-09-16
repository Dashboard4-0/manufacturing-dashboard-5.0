# MS5.0 Disaster Recovery Procedures

## Overview

This document outlines the disaster recovery (DR) procedures for the MS5.0 Manufacturing System.
These procedures ensure business continuity and minimal data loss in the event of system failures,
data corruption, or catastrophic events.

## Recovery Objectives

### Recovery Time Objective (RTO)

- **Critical Services**: 1 hour
- **Core Services**: 4 hours
- **Non-Critical Services**: 24 hours

### Recovery Point Objective (RPO)

- **Production Data**: 15 minutes
- **Telemetry Data**: 5 minutes
- **Configuration Data**: 1 hour
- **Audit Logs**: 0 (no data loss)

## Service Criticality Classification

### Critical Services

- Gateway API Service
- PostgreSQL Database (Primary)
- Redis Cache
- Kafka Message Bus
- Authentication Service

### Core Services

- TimescaleDB Analytics
- GraphQL Federation Router
- WebSocket Gateway
- Alert Manager
- SQDC Service

### Non-Critical Services

- Report Generator
- Export Service
- Developer Portal
- Monitoring Dashboard

## Backup Strategy

### Database Backups

#### PostgreSQL/TimescaleDB

```bash
# Full backup (daily)
pg_dump -h $DB_HOST -U $DB_USER -d ms5db -F c -b -v -f "ms5db_full_$(date +%Y%m%d).backup"

# Incremental backup (every 4 hours)
pg_basebackup -h $DB_HOST -U $DB_USER -D /backup/incremental -Ft -z -P

# Point-in-time recovery setup
postgresql.conf:
  wal_level = replica
  archive_mode = on
  archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
```

#### Redis Snapshots

```bash
# Enable AOF persistence
redis-cli CONFIG SET appendonly yes
redis-cli CONFIG SET appendfsync everysec

# Manual snapshot
redis-cli BGSAVE

# Automated snapshots (redis.conf)
save 900 1     # After 900 sec if at least 1 key changed
save 300 10    # After 300 sec if at least 10 keys changed
save 60 10000  # After 60 sec if at least 10000 keys changed
```

### Application State Backup

```bash
#!/bin/bash
# backup-state.sh

# Export Kubernetes configurations
kubectl get all --all-namespaces -o yaml > k8s-state.yaml
kubectl get configmaps --all-namespaces -o yaml > k8s-configmaps.yaml
kubectl get secrets --all-namespaces -o yaml > k8s-secrets.yaml

# Export Docker volumes
docker run --rm -v ms5_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/docker-volumes.tar.gz /data

# Upload to S3
aws s3 cp k8s-state.yaml s3://ms5-backups/state/
aws s3 cp k8s-configmaps.yaml s3://ms5-backups/state/
aws s3 cp k8s-secrets.yaml s3://ms5-backups/state/
aws s3 cp docker-volumes.tar.gz s3://ms5-backups/volumes/
```

## Disaster Scenarios and Recovery Procedures

### Scenario 1: Database Corruption

#### Detection

- Monitoring alerts on database errors
- Application errors related to data integrity
- Failed health checks

#### Recovery Steps

1. **Isolate the affected database**

```bash
# Stop applications from writing
kubectl scale deployment ms5-gateway --replicas=0
kubectl scale deployment ms5-analytics --replicas=0
```

2. **Assess corruption extent**

```sql
-- Check for corruption
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Verify with pg_dump
pg_dump -d ms5db -s -f /tmp/schema_test.sql
```

3. **Restore from backup**

```bash
# Point-in-time recovery
pg_ctl stop -D /var/lib/postgresql/data

# Restore base backup
rm -rf /var/lib/postgresql/data/*
tar -xzf /backup/base/latest.tar.gz -C /var/lib/postgresql/data/

# Create recovery.conf
cat > /var/lib/postgresql/data/recovery.conf <<EOF
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2024-01-15 10:00:00'
recovery_target_action = 'promote'
EOF

# Start PostgreSQL
pg_ctl start -D /var/lib/postgresql/data
```

4. **Verify data integrity**

```sql
-- Run integrity checks
VACUUM ANALYZE;
REINDEX DATABASE ms5db;

-- Verify critical tables
SELECT COUNT(*) FROM production_lines;
SELECT COUNT(*) FROM telemetry WHERE timestamp > NOW() - INTERVAL '1 hour';
```

5. **Resume services**

```bash
kubectl scale deployment ms5-gateway --replicas=3
kubectl scale deployment ms5-analytics --replicas=2
```

### Scenario 2: Complete Data Center Failure

#### Recovery Steps

1. **Activate DR site**

```bash
# Switch DNS to DR site
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch file://dr-dns-switch.json

# Verify DNS propagation
dig api.ms5.com
```

2. **Deploy infrastructure in DR region**

```bash
# Using Terraform
cd infrastructure/terraform/dr-region
terraform init
terraform plan -var-file=dr.tfvars
terraform apply -auto-approve

# Deploy Kubernetes cluster
eksctl create cluster -f dr-cluster.yaml
```

3. **Restore data from S3**

```bash
# Download latest backups
aws s3 sync s3://ms5-backups/database/ /restore/database/
aws s3 sync s3://ms5-backups/state/ /restore/state/

# Restore PostgreSQL
creatdb -h $DR_DB_HOST -U $DB_USER ms5db
pg_restore -h $DR_DB_HOST -U $DB_USER -d ms5db /restore/database/latest.backup

# Restore Redis
redis-cli --rdb /restore/redis/dump.rdb
```

4. **Deploy applications**

```bash
# Apply Kubernetes manifests
kubectl apply -f /restore/state/k8s-state.yaml
kubectl apply -f /restore/state/k8s-configmaps.yaml
kubectl apply -f /restore/state/k8s-secrets.yaml

# Verify deployments
kubectl get pods --all-namespaces
kubectl get services --all-namespaces
```

5. **Validate recovery**

```bash
# Run smoke tests
pnpm test:e2e:smoke

# Check critical endpoints
curl https://dr.api.ms5.com/health
curl https://dr.api.ms5.com/api/v2/production-lines

# Monitor metrics
kubectl port-forward svc/prometheus 9090:9090
```

### Scenario 3: Ransomware Attack

#### Immediate Response

1. **Isolate affected systems**

```bash
# Network isolation
iptables -I INPUT -j DROP
iptables -I OUTPUT -j DROP

# Preserve evidence
dd if=/dev/sda of=/evidence/disk.img bs=64K conv=noerror,sync
```

2. **Activate incident response**

```bash
# Notify security team
./scripts/notify-security.sh "CRITICAL: Ransomware detected"

# Enable read-only mode
kubectl patch deployment ms5-gateway -p '{"spec":{"template":{"spec":{"containers":[{"name":"gateway","env":[{"name":"READ_ONLY_MODE","value":"true"}]}]}}}}'
```

#### Recovery Steps

1. **Deploy clean infrastructure**

```bash
# Use isolated recovery environment
terraform workspace new recovery
terraform apply -var-file=recovery.tfvars
```

2. **Restore from immutable backups**

```bash
# Verify backup integrity
for file in /backup/*.backup; do
  sha256sum -c "$file.sha256"
done

# Restore verified backups
pg_restore -h $RECOVERY_DB_HOST -U $DB_USER -d ms5db \
  /backup/verified/ms5db_clean.backup
```

3. **Reset all credentials**

```bash
# Generate new secrets
./scripts/rotate-secrets.sh --all

# Update Kubernetes secrets
kubectl delete secret --all -n ms5
kubectl apply -f new-secrets.yaml
```

4. **Audit and monitor**

```sql
-- Check for suspicious data
SELECT * FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '7 days'
  AND action IN ('DELETE', 'UPDATE', 'TRUNCATE');

-- Monitor for anomalies
SELECT user_id, COUNT(*) as action_count
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY user_id
HAVING COUNT(*) > 1000;
```

### Scenario 4: Data Corruption in Kafka

#### Recovery Steps

1. **Stop producers**

```bash
kubectl scale deployment ms5-telemetry-collector --replicas=0
kubectl scale deployment ms5-event-processor --replicas=0
```

2. **Identify corrupted partitions**

```bash
# Check partition health
kafka-topics.sh --bootstrap-server localhost:9092 \
  --describe --topic telemetry

# Verify segment files
kafka-run-class.sh kafka.tools.DumpLogSegments \
  --files /kafka/telemetry-0/00000000000000000000.log \
  --verify-index-only
```

3. **Recover from replicas**

```bash
# Reassign partitions
kafka-reassign-partitions.sh \
  --bootstrap-server localhost:9092 \
  --reassignment-json-file recovery-plan.json \
  --execute

# Monitor recovery
kafka-reassign-partitions.sh \
  --bootstrap-server localhost:9092 \
  --reassignment-json-file recovery-plan.json \
  --verify
```

4. **Reset consumer offsets**

```bash
# Reset to earliest
kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group ms5-analytics \
  --reset-offsets --to-earliest \
  --all-topics --execute
```

## Automated Recovery Scripts

### Health Check and Auto-Recovery

```bash
#!/bin/bash
# auto-recovery.sh

check_service() {
  local service=$1
  local url=$2

  if ! curl -f -s "$url" > /dev/null; then
    echo "Service $service is down. Attempting recovery..."

    case $service in
      "gateway")
        kubectl rollout restart deployment/ms5-gateway
        ;;
      "database")
        systemctl restart postgresql
        ;;
      "redis")
        systemctl restart redis
        ;;
      "kafka")
        kafka-server-start.sh /etc/kafka/server.properties &
        ;;
    esac

    sleep 30

    if curl -f -s "$url" > /dev/null; then
      echo "Service $service recovered successfully"
      notify_ops "Service $service auto-recovered"
    else
      echo "Service $service recovery failed"
      notify_ops "CRITICAL: Service $service requires manual intervention"
      initiate_failover $service
    fi
  fi
}

# Monitor critical services
while true; do
  check_service "gateway" "http://localhost:4000/health"
  check_service "database" "http://localhost:5432"
  check_service "redis" "http://localhost:6379"
  check_service "kafka" "http://localhost:9092"
  sleep 60
done
```

### Backup Verification

```python
#!/usr/bin/env python3
# verify-backups.py

import subprocess
import hashlib
import boto3
from datetime import datetime, timedelta

def verify_backup(backup_file):
    """Verify backup integrity"""
    # Check file hash
    with open(f"{backup_file}.sha256", 'r') as f:
        expected_hash = f.read().strip()

    sha256_hash = hashlib.sha256()
    with open(backup_file, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)

    actual_hash = sha256_hash.hexdigest()

    if actual_hash != expected_hash:
        raise ValueError(f"Hash mismatch for {backup_file}")

    # Test restore
    result = subprocess.run([
        'pg_restore',
        '--list',
        backup_file
    ], capture_output=True)

    if result.returncode != 0:
        raise ValueError(f"Backup {backup_file} is corrupted")

    return True

def check_backup_age():
    """Ensure recent backups exist"""
    s3 = boto3.client('s3')
    bucket = 'ms5-backups'

    response = s3.list_objects_v2(
        Bucket=bucket,
        Prefix='database/',
        MaxKeys=10
    )

    if 'Contents' not in response:
        raise ValueError("No backups found")

    latest = max(response['Contents'], key=lambda x: x['LastModified'])
    age = datetime.now(latest['LastModified'].tzinfo) - latest['LastModified']

    if age > timedelta(hours=24):
        raise ValueError(f"Latest backup is {age.total_seconds()/3600:.1f} hours old")

    return True

if __name__ == "__main__":
    try:
        verify_backup('/backup/latest.backup')
        check_backup_age()
        print("Backup verification successful")
    except Exception as e:
        print(f"Backup verification failed: {e}")
        # Send alert
        subprocess.run(['./notify-ops.sh', f'CRITICAL: {e}'])
        exit(1)
```

## Testing and Drills

### Monthly DR Drill Schedule

1. **Week 1**: Database failover test
2. **Week 2**: Service recovery test
3. **Week 3**: Full DR site activation
4. **Week 4**: Backup restoration test

### DR Test Checklist

- [ ] Verify all backup jobs completed successfully
- [ ] Test backup restoration to isolated environment
- [ ] Validate data integrity after restoration
- [ ] Test failover procedures
- [ ] Verify monitoring and alerting
- [ ] Update runbooks based on findings
- [ ] Document recovery times
- [ ] Review and update contact lists

## Contact Information

### Escalation Matrix

| Level | Role                   | Contact             | Response Time |
| ----- | ---------------------- | ------------------- | ------------- |
| L1    | On-Call Engineer       | ops-oncall@ms5.com  | 15 minutes    |
| L2    | DevOps Lead            | devops-lead@ms5.com | 30 minutes    |
| L3    | Infrastructure Manager | infra-mgr@ms5.com   | 1 hour        |
| L4    | CTO                    | cto@ms5.com         | 2 hours       |

### Emergency Contacts

- **AWS Support**: 1-800-xxx-xxxx (Enterprise Support)
- **Database Vendor**: support@timescale.com
- **Security Team**: security@ms5.com
- **Legal Team**: legal@ms5.com

## Appendix

### Recovery Command Reference

```bash
# PostgreSQL
pg_dump -Fc ms5db > backup.dump
pg_restore -d ms5db backup.dump

# Redis
redis-cli BGSAVE
redis-cli --rdb dump.rdb

# Kubernetes
kubectl get all -A -o yaml > state.yaml
kubectl apply -f state.yaml

# Docker
docker commit <container> backup:latest
docker save backup:latest | gzip > backup.tar.gz
docker load < backup.tar.gz

# Terraform
terraform state pull > state.json
terraform state push state.json
```

### Post-Recovery Validation

```sql
-- Data integrity checks
SELECT
  schemaname,
  tablename,
  n_live_tup as row_count
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

-- Check for data gaps
SELECT
  date_trunc('hour', timestamp) as hour,
  COUNT(*) as record_count
FROM telemetry
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour;

-- Verify audit trail continuity
SELECT
  LAG(hash) OVER (ORDER BY timestamp) as prev_hash,
  hash,
  timestamp
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp;
```
