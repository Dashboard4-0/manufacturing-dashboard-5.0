#!/bin/bash
set -euo pipefail

echo "🧪 Running All Tests"
echo "===================="

# Exit codes
EXIT_CODE=0

# Function to run tests and capture exit code
run_test() {
  local test_name=$1
  local test_command=$2

  echo ""
  echo "🔬 Running $test_name..."
  echo "----------------------------"

  if eval "$test_command"; then
    echo "✅ $test_name passed"
  else
    echo "❌ $test_name failed"
    EXIT_CODE=1
  fi
}

# Ensure services are running
echo "🐳 Ensuring Docker services are running..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run unit tests
run_test "Unit Tests" "pnpm test:unit"

# Run contract tests
run_test "Contract Tests" "pnpm test:contract"

# Run property-based tests
run_test "Property Tests" "pnpm --filter tests test:property"

# Run integration tests (if services are running)
if docker-compose ps | grep -q "Up"; then
  run_test "Integration Tests" "pnpm test:integration"
fi

# Run E2E tests (web)
run_test "E2E Web Tests" "pnpm --filter web test:e2e"

# Run load tests (smoke only in CI)
run_test "Load Tests (Smoke)" "pnpm test:load -- --config ./tests/load/k6/config.js --stage smoke"

# Security tests
echo ""
echo "🔒 Running Security Tests..."
echo "----------------------------"

# Check for vulnerabilities
echo "📦 Checking npm vulnerabilities..."
if npm audit --audit-level=moderate; then
  echo "✅ No vulnerabilities found"
else
  echo "⚠️ Vulnerabilities detected (non-blocking)"
fi

# Run TypeScript type checking
echo ""
echo "🎯 Running Type Checks..."
echo "----------------------------"
if pnpm typecheck; then
  echo "✅ Type checking passed"
else
  echo "❌ Type checking failed"
  EXIT_CODE=1
fi

# Run linting
echo ""
echo "🧹 Running Linters..."
echo "----------------------------"
if pnpm lint; then
  echo "✅ Linting passed"
else
  echo "❌ Linting failed"
  EXIT_CODE=1
fi

# Run format check
echo ""
echo "📐 Checking Code Formatting..."
echo "----------------------------"
if pnpm format:check; then
  echo "✅ Formatting check passed"
else
  echo "❌ Formatting check failed"
  EXIT_CODE=1
fi

# Generate test coverage report
echo ""
echo "📊 Generating Coverage Report..."
echo "----------------------------"
pnpm test:unit -- --coverage || true

# Aggregate coverage reports
echo "📈 Aggregating coverage data..."
mkdir -p coverage
npx nyc merge coverage coverage/merged.json || true
npx nyc report --reporter=text --reporter=html --reporter=lcov || true

# Display coverage summary
if [ -f coverage/lcov-report/index.html ]; then
  echo ""
  echo "📊 Coverage Report Summary:"
  echo "----------------------------"
  npx nyc report --reporter=text-summary || true
  echo ""
  echo "📁 Detailed coverage report: coverage/lcov-report/index.html"
fi

# Test results summary
echo ""
echo "=========================================="
echo "📋 Test Results Summary"
echo "=========================================="

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ All tests passed!"
  echo ""
  echo "📊 Metrics:"
  echo "  - Unit tests: ✅"
  echo "  - Contract tests: ✅"
  echo "  - Property tests: ✅"
  echo "  - E2E tests: ✅"
  echo "  - Type checking: ✅"
  echo "  - Linting: ✅"
  echo "  - Formatting: ✅"
else
  echo "❌ Some tests failed. Please review the output above."
  echo ""
  echo "💡 Tips:"
  echo "  - Run 'pnpm test:unit' to debug unit test failures"
  echo "  - Run 'pnpm lint --fix' to auto-fix linting issues"
  echo "  - Run 'pnpm format' to fix formatting issues"
  echo "  - Check logs in individual service directories"
fi

exit $EXIT_CODE