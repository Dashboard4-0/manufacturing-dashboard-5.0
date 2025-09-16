.PHONY: help install dev build test lint format clean docker-up docker-down db-migrate db-seed

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	pnpm install

dev: ## Start development environment
	docker-compose up -d
	pnpm dev

build: ## Build all services
	pnpm build

test: ## Run all tests
	pnpm test

test-unit: ## Run unit tests
	pnpm test:unit

test-contract: ## Run contract tests
	pnpm test:contract

test-e2e: ## Run E2E tests
	pnpm test:e2e

test-load: ## Run load tests
	pnpm test:load

lint: ## Run linting
	pnpm lint

format: ## Format code
	pnpm format

format-check: ## Check code formatting
	pnpm format:check

typecheck: ## Run type checking
	pnpm typecheck

clean: ## Clean build artifacts
	pnpm clean
	rm -rf node_modules
	rm -rf .turbo
	find . -name "dist" -type d -prune -exec rm -rf {} +
	find . -name "build" -type d -prune -exec rm -rf {} +
	find . -name ".tsbuildinfo" -type f -delete

docker-up: ## Start Docker services
	docker-compose up -d

docker-down: ## Stop Docker services
	docker-compose down

docker-clean: ## Clean Docker volumes
	docker-compose down -v

db-migrate: ## Run database migrations
	./tools/scripts/db-migrate.sh

db-seed: ## Seed database
	./tools/scripts/seed.sh

db-reset: ## Reset database
	docker-compose down -v postgres timescale
	docker-compose up -d postgres timescale
	sleep 5
	$(MAKE) db-migrate
	$(MAKE) db-seed

kafka-topics: ## Create Kafka topics
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic telemetry.asset.event --partitions 3 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic dms.action --partitions 2 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic andon.trigger --partitions 2 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic quality.spc.sample --partitions 3 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic maintenance.workorder --partitions 2 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic change.request --partitions 1 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic audit.record --partitions 1 --replication-factor 1 --if-not-exists
	docker-compose exec kafka kafka-topics --create --bootstrap-server localhost:9092 --topic maturity.assessment --partitions 1 --replication-factor 1 --if-not-exists

minio-buckets: ## Create MinIO buckets
	docker-compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin123
	docker-compose exec minio mc mb local/assets --ignore-existing
	docker-compose exec minio mc mb local/documents --ignore-existing
	docker-compose exec minio mc mb local/images --ignore-existing
	docker-compose exec minio mc mb local/reports --ignore-existing
	docker-compose exec minio mc mb local/backups --ignore-existing

setup: install docker-up ## Complete setup
	sleep 10
	$(MAKE) kafka-topics
	$(MAKE) minio-buckets
	$(MAKE) db-migrate
	$(MAKE) db-seed
	@echo "Setup complete! Run 'make dev' to start development"

jetson-setup: ## Setup for NVIDIA Jetson deployment
	./tools/scripts/jetson-setup.sh

sbom: ## Generate Software Bill of Materials
	./tools/scripts/generate-sbom.sh

security-scan: ## Run security scanning
	trivy fs --severity HIGH,CRITICAL .
	npm audit --audit-level=moderate

helm-lint: ## Lint Helm charts
	find infra/helm -mindepth 1 -maxdepth 1 -type d -exec helm lint {} \;

terraform-fmt: ## Format Terraform files
	terraform fmt -recursive infra/terraform/

terraform-validate: ## Validate Terraform configuration
	cd infra/terraform/envs/dev && terraform init -backend=false && terraform validate
	cd infra/terraform/envs/prod && terraform init -backend=false && terraform validate

ci: format-check lint typecheck test ## Run CI checks locally

cd-dry-run: build ## Dry run CD pipeline
	@echo "Building Docker images..."
	docker build -f services/ms5.0-gateway/Dockerfile -t ms5.0-gateway:local services/ms5.0-gateway
	@echo "Linting Helm charts..."
	$(MAKE) helm-lint
	@echo "CD dry run complete!"