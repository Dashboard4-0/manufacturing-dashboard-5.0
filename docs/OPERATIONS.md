# MS5.0 Operations Guide

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Deployment](#deployment)
3. [Monitoring](#monitoring)
4. [Backup & Recovery](#backup--recovery)
5. [Disaster Recovery](#disaster-recovery)
6. [Troubleshooting](#troubleshooting)
7. [Maintenance](#maintenance)
8. [Performance Tuning](#performance-tuning)

## System Requirements

### Cloud (AKS) Requirements

- **Kubernetes Version**: 1.28+
- **Node Pool**:
  - System: 3 nodes, Standard_DS2_v2 (2 vCPU, 7GB RAM)
  - User: 3-10 nodes, Standard_DS3_v2 (4 vCPU, 14GB RAM)
- **Storage**: Premium SSD, 500GB minimum
- **Network**: Azure CNI with Calico network policies

### Edge (K3s) Requirements

- **Hardware**: NVIDIA Jetson Orin NX 16GB
- **Storage**: NVMe SSD 256GB minimum
- **Network**: Gigabit Ethernet
- **OS**: Ubuntu 20.04 LTS for Jetson

### Database Requirements

- **PostgreSQL**: 15+ with TimescaleDB 2.14+
- **CPU**: 4 cores minimum
- **RAM**: 16GB minimum
- **Storage**: 500GB SSD with 10,000 IOPS

## Deployment

### Production Deployment (AKS)

#### Prerequisites

```bash
# Install required tools
az --version          # Azure CLI 2.50+
kubectl version       # kubectl 1.28+
helm version         # Helm 3.13+
terraform --version  # Terraform 1.6+
```

#### Deploy Infrastructure

```bash
# Navigate to Terraform directory
cd infra/terraform/environments/production

# Initialize Terraform
terraform init

# Review deployment plan
terraform plan -out=tfplan

# Apply infrastructure
terraform apply tfplan

# Get AKS credentials
az aks get-credentials --resource-group ms5-prod-rg --name ms5-prod-aks
```

#### Deploy Applications

```bash
# Create namespaces
kubectl create namespace ms5
kubectl create namespace monitoring
kubectl create namespace ingress-nginx

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Deploy secrets
kubectl create secret generic ms5-secrets \
  --from-env-file=.env.production \
  -n ms5

# Deploy database
helm install postgres bitnami/postgresql \
  -f infra/helm/postgres/values-production.yaml \
  -n ms5

# Install TimescaleDB extension
kubectl exec -n ms5 postgres-0 -- psql -U postgres -d ms5db \
  -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# Deploy Kafka
helm install kafka bitnami/kafka \
  -f infra/helm/kafka/values-production.yaml \
  -n ms5

# Deploy Redis
helm install redis bitnami/redis \
  -f infra/helm/redis/values-production.yaml \
  -n ms5

# Deploy MS5 services
kubectl apply -k infra/k8s/overlays/production

# Deploy monitoring stack
helm install prometheus prometheus-community/kube-prometheus-stack \
  -f infra/helm/prometheus/values.yaml \
  -n monitoring

helm install grafana grafana/grafana \
  -f infra/helm/grafana/values.yaml \
  -n monitoring

# Deploy ingress controller
helm install nginx-ingress ingress-nginx/ingress-nginx \
  -f infra/helm/nginx/values.yaml \
  -n ingress-nginx
```

#### Verify Deployment

```bash
# Check pod status
kubectl get pods -n ms5
kubectl get pods -n monitoring

# Check services
kubectl get svc -n ms5

# Check ingress
kubectl get ingress -n ms5

# Run health checks
./scripts/health-check.sh production
```

### Edge Deployment (K3s on Jetson)

#### Install K3s

```bash
# On Jetson device
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --disable servicelb

# Verify installation
sudo k3s kubectl get nodes
```

#### Deploy Edge Gateway

```bash
# Copy kubeconfig
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Create namespace
kubectl create namespace edge

# Deploy SQLite PVC
kubectl apply -f infra/k8s/edge/sqlite-pvc.yaml

# Deploy edge gateway
kubectl apply -f infra/k8s/edge/edge-gateway.yaml

# Deploy OPC UA connector
kubectl apply -f infra/k8s/edge/opcua-connector.yaml
```

## Monitoring

### Prometheus Metrics

- **URL**: http://prometheus.ms5.local:9090
- **Key Metrics**:
  - `ms5_oee_percentage` - Real-time OEE by line
  - `ms5_andon_triggers_total` - Andon trigger count
  - `ms5_action_completion_duration_hours` - SQDC action completion time
  - `ms5_data_ingestion_rate` - Telemetry ingestion rate

### Grafana Dashboards

- **URL**: http://grafana.ms5.local:3000
- **Default Login**: admin / (retrieve from secret)
- **Dashboards**:
  - MS5 Overview - System health and KPIs
  - Production Metrics - OEE, quality, performance
  - Infrastructure - K8s cluster metrics
  - Alerts - Active alerts and incidents

### Jaeger Tracing

- **URL**: http://jaeger.ms5.local:16686
- **Usage**: Distributed request tracing
- **Retention**: 7 days

### Log Aggregation

```bash
# View logs for a service
kubectl logs -n ms5 -l app=ms5-gateway --tail=100 -f

# Search logs with OpenSearch
curl -X GET "opensearch.ms5.local:9200/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "match": {
        "service": "dms-service"
      }
    }
  }'
```

## Backup & Recovery

### Automated Database Backup

Backups run automatically via CronJob at 02:00 UTC daily.

### Manual Database Backup

```bash
# Create manual backup
kubectl exec -n ms5 postgres-0 -- pg_dump \
  -h localhost -U ms5user -d ms5db \
  --verbose --format=custom \
  > backup-$(date +%Y%m%d-%H%M%S).dump

# Upload to Azure Blob Storage
az storage blob upload \
  --account-name ms5backups \
  --container-name postgres \
  --name backup-$(date +%Y%m%d-%H%M%S).dump \
  --file backup-*.dump
```

### Database Restore

```bash
# Download backup from storage
az storage blob download \
  --account-name ms5backups \
  --container-name postgres \
  --name backup-20250115.dump \
  --file restore.dump

# Restore database
kubectl exec -n ms5 postgres-0 -- pg_restore \
  -h localhost -U ms5user -d ms5db \
  --clean --if-exists \
  < restore.dump
```

### Kafka Topic Backup

```bash
# Export Kafka topics
kubectl exec -n ms5 kafka-0 -- kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --list > topics.txt

# Backup topic data
kubectl exec -n ms5 kafka-0 -- kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic ms5.telemetry \
  --from-beginning \
  --max-messages 1000000 \
  > telemetry-backup.json
```

## Disaster Recovery

### RTO/RPO Targets

- **RTO (Recovery Time Objective)**: 5 minutes
- **RPO (Recovery Point Objective)**: 15 minutes

### Failover Procedure

#### 1. Detect Primary Failure

```bash
# Check cluster health
kubectl get nodes
kubectl get pods -n ms5 --field-selector status.phase!=Running

# Check database status
kubectl exec -n ms5 postgres-0 -- pg_isready
```

#### 2. Initiate Failover

```bash
# Scale down primary region
kubectl scale deployment --all -n ms5 --replicas=0

# Promote secondary database
kubectl exec -n ms5 postgres-secondary-0 -- pg_ctl promote

# Update DNS to point to secondary region
az network dns record-set a update \
  --resource-group ms5-dns \
  --zone-name ms5.example.com \
  --name api \
  --set aRecords[0].ipv4Address=<secondary-ip>
```

#### 3. Verify Services

```bash
# Check secondary region services
kubectl --context=secondary get pods -n ms5

# Test API endpoints
curl https://api-dr.ms5.example.com/health

# Verify data integrity
kubectl exec -n ms5 postgres-secondary-0 -- psql -U ms5user -d ms5db \
  -c "SELECT COUNT(*) FROM audit_logs WHERE created_at > NOW() - INTERVAL '1 hour';"
```

### Failback Procedure

```bash
# 1. Restore primary database
kubectl exec -n ms5 postgres-0 -- pg_basebackup \
  -h postgres-secondary -U replicator -D /var/lib/postgresql/data \
  -P -X stream

# 2. Start primary services
kubectl scale deployment --all -n ms5 --replicas=3

# 3. Verify sync
kubectl exec -n ms5 postgres-0 -- psql -U ms5user -d ms5db \
  -c "SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();"

# 4. Switch DNS back
az network dns record-set a update \
  --resource-group ms5-dns \
  --zone-name ms5.example.com \
  --name api \
  --set aRecords[0].ipv4Address=<primary-ip>

# 5. Scale down secondary
kubectl --context=secondary scale deployment --all -n ms5 --replicas=0
```

## Troubleshooting

### Common Issues

#### High Memory Usage

```bash
# Check memory usage
kubectl top pods -n ms5

# Find memory leaks
kubectl exec -n ms5 <pod-name> -- pprof http://localhost:6060/debug/pprof/heap

# Restart pod if needed
kubectl delete pod <pod-name> -n ms5
```

#### Kafka Consumer Lag

```bash
# Check consumer lag
kubectl exec -n ms5 kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group ms5-consumer-group

# Reset consumer offset if needed
kubectl exec -n ms5 kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group ms5-consumer-group \
  --reset-offsets --to-earliest --execute --all-topics
```

#### Database Connection Issues

```bash
# Check connection pool
kubectl exec -n ms5 postgres-0 -- psql -U ms5user -d ms5db \
  -c "SELECT count(*) FROM pg_stat_activity;"

# Kill idle connections
kubectl exec -n ms5 postgres-0 -- psql -U ms5user -d ms5db \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE state = 'idle' AND state_change < NOW() - INTERVAL '10 minutes';"
```

#### OPC UA Connection Failed

```bash
# Check OPC UA server status
kubectl logs -n edge opcua-connector --tail=100

# Restart connector
kubectl rollout restart deployment opcua-connector -n edge

# Test connection manually
kubectl exec -n edge opcua-connector -- opcua-client \
  --endpoint opc.tcp://plc1.local:4840 \
  --browse
```

### Debug Commands

```bash
# Get pod details
kubectl describe pod <pod-name> -n ms5

# Access pod shell
kubectl exec -it <pod-name> -n ms5 -- /bin/sh

# Port forward for debugging
kubectl port-forward -n ms5 svc/ms5-gateway 3000:3000

# View recent events
kubectl get events -n ms5 --sort-by='.lastTimestamp'

# Check resource quotas
kubectl describe resourcequota -n ms5
```

## Maintenance

### Weekly Tasks

- Review error logs and alerts
- Check backup integrity
- Update security patches
- Review resource utilisation

### Monthly Tasks

- Rotate secrets and certificates
- Performance analysis
- Capacity planning review
- Disaster recovery test

### Upgrade Procedures

#### Kubernetes Upgrade

```bash
# Check available versions
az aks get-upgrades --resource-group ms5-prod-rg --name ms5-prod-aks

# Upgrade control plane
az aks upgrade \
  --resource-group ms5-prod-rg \
  --name ms5-prod-aks \
  --kubernetes-version 1.29.0 \
  --control-plane-only

# Upgrade node pools
az aks nodepool upgrade \
  --resource-group ms5-prod-rg \
  --cluster-name ms5-prod-aks \
  --name systempool \
  --kubernetes-version 1.29.0
```

#### Application Upgrade

```bash
# Build and push new images
docker build -t ms5/gateway:v1.1.0 ./services/ms5.0-gateway
docker push ms5/gateway:v1.1.0

# Update deployment
kubectl set image deployment/ms5-gateway \
  ms5-gateway=ms5/gateway:v1.1.0 \
  -n ms5

# Monitor rollout
kubectl rollout status deployment/ms5-gateway -n ms5

# Rollback if needed
kubectl rollout undo deployment/ms5-gateway -n ms5
```

## Performance Tuning

### Database Optimisation

```sql
-- Update statistics
ANALYZE;

-- Reindex tables
REINDEX TABLE telemetry;

-- Configure autovacuum
ALTER TABLE telemetry SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_telemetry_timestamp
ON telemetry(timestamp DESC);
```

### Kubernetes Resource Tuning

```yaml
# Update resource limits
kubectl patch deployment ms5-gateway -n ms5 --type='json' -p='[
  {
    "op": "replace",
    "path": "/spec/template/spec/containers/0/resources/limits/memory",
    "value": "2Gi"
  }
]'

# Configure HPA
kubectl autoscale deployment ms5-gateway -n ms5 \
  --cpu-percent=70 \
  --min=3 \
  --max=10
```

### Network Optimisation

```bash
# Enable connection pooling
kubectl set env deployment/ms5-gateway -n ms5 \
  DB_POOL_SIZE=30 \
  DB_POOL_TIMEOUT=10000

# Configure keep-alive
kubectl patch service ms5-gateway -n ms5 -p \
  '{"spec":{"sessionAffinity":"ClientIP","sessionAffinityConfig":{"clientIP":{"timeoutSeconds":10800}}}}'
```

## Emergency Contacts

| Role               | Contact                       | Escalation            |
| ------------------ | ----------------------------- | --------------------- |
| On-Call Engineer   | PagerDuty                     | Primary               |
| Platform Team Lead | platform-lead@ms5.example.com | Secondary             |
| Database Admin     | dba-team@ms5.example.com      | Database issues       |
| Security Team      | security@ms5.example.com      | Security incidents    |
| Vendor Support     | support@vendor.com            | Hardware/Cloud issues |

## Runbook References

- [Incident Response](./runbooks/incident-response.md)
- [Security Breach](./runbooks/security-breach.md)
- [Data Recovery](./runbooks/data-recovery.md)
- [Performance Degradation](./runbooks/performance-degradation.md)
- [Network Outage](./runbooks/network-outage.md)
