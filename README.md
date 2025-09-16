# MS5.0 - Manufacturing System 5.0

Production-ready Manufacturing Execution System implementing comprehensive shop floor digitalisation
with real-time OEE, DMS, Andon, Quality Management, and 15+ integrated operational modules.

## Architecture

- **Monorepo**: Turborepo + pnpm workspaces
- **Backend**: TypeScript/Node.js 20 LTS microservices
- **Frontend**: React 18 PWA + Flutter mobile
- **Data**: PostgreSQL 15, TimescaleDB 2.14, Kafka 3.6
- **Edge**: OPC UA ingestion, store-and-forward, mTLS sync
- **Deploy**: Kubernetes (AKS cloud, K3s edge on NVIDIA Jetson)
- **Security**: OIDC (Azure AD), mTLS, Vault, OPA policies

## Quick Start

```bash
# Bootstrap development environment
./tools/scripts/dev-bootstrap.sh

# Run locally with Docker Compose
docker-compose up -d

# Run tests
pnpm test

# Build all services
pnpm build

# Deploy to Kubernetes
helm upgrade --install ms5 ./infra/helm/ms5.0-gateway -n ms5 --create-namespace
```

## Services

| Service                     | Port | Description                      |
| --------------------------- | ---- | -------------------------------- |
| ms5.0-gateway               | 3000 | GraphQL/REST API gateway         |
| dms-service                 | 3001 | Daily Management System          |
| loss-analytics-service      | 3002 | OEE & loss analytics             |
| operator-care-service       | 3003 | Operator profiles & capabilities |
| pm-planner-service          | 3004 | Preventive maintenance           |
| centerline-service          | 3005 | Process centerline management    |
| quality-spc-service         | 3006 | SPC & quality control            |
| early-asset-mgmt-service    | 3007 | Asset telemetry & predictive     |
| standard-work-service       | 3008 | Work instructions & audit        |
| problem-solving-service     | 3009 | RCA & problem management         |
| andon-service               | 3010 | Andon system & escalation        |
| handover-service            | 3011 | Shift handover management        |
| safety-service              | 3012 | Permits & LOTO                   |
| skills-service              | 3013 | Skills matrix & training         |
| energy-service              | 3014 | Energy monitoring                |
| compliance-audit-service    | 3015 | Compliance & audit               |
| master-data-service         | 3016 | Sites, lines, assets, products   |
| integration-hub             | 3017 | ERP/MES/CMMS connectors          |
| governance-maturity-service | 3018 | Maturity assessment              |
| edge-gateway                | 3019 | OPC UA & store-forward           |

## Development

```bash
# Install dependencies
pnpm install

# Run service in dev mode
pnpm --filter dms-service dev

# Run database migrations
./tools/scripts/db-migrate.sh

# Seed database
./tools/scripts/seed.sh

# Generate SBOM
./tools/scripts/generate-sbom.sh
```

## Testing

```bash
# Unit tests
pnpm test:unit

# Contract tests
pnpm test:contract

# E2E tests
pnpm test:e2e

# Load tests
pnpm test:load

# All tests
./tools/scripts/test-all.sh
```

## Edge Deployment (NVIDIA Jetson)

```bash
# Setup Jetson Orin NX
./tools/scripts/jetson-setup.sh

# Deploy K3s cluster
kubectl apply -f infra/k8s/runtimeclass-nvidia.yaml
helm install ms5-edge ./infra/helm/edge-gateway
```

## Security

- OIDC authentication via Azure AD
- mTLS service-to-service communication
- HashiCorp Vault for secrets management
- OPA/Gatekeeper policy enforcement
- TLS 1.3 everywhere
- Signed audit logs with hash chaining

## Observability

- OpenTelemetry traces, metrics, logs
- Prometheus + Grafana dashboards
- OpenSearch log aggregation
- Custom SLO error budget alerts

## Documentation

- [Operations Guide](docs/OPERATIONS.md)
- [Security Guide](docs/SECURITY.md)
- [Jetson Deployment](docs/JETSON.md)
- [Architecture Decision Records](docs/ADRs/)
- [Runbooks](docs/RUNBOOKS/)

## License

Proprietary - All rights reserved

## Support

Internal support via ServiceNow
