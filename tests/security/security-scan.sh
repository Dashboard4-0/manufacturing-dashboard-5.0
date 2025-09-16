#!/bin/bash

# MS5.0 Security Scanning Script
# Performs comprehensive security analysis of the application

set -e

echo "========================================"
echo "MS5.0 Manufacturing System Security Scan"
echo "========================================"
echo ""

# Colour codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

# Results tracking
VULNERABILITIES=0
WARNINGS=0

# 1. Dependency vulnerability scanning
echo "1. Scanning npm dependencies for vulnerabilities..."
echo "================================================"

npm audit --json > npm-audit-report.json 2>/dev/null || true
NPM_VULNS=$(cat npm-audit-report.json | jq '.metadata.vulnerabilities.total' 2>/dev/null || echo "0")

if [ "$NPM_VULNS" -gt 0 ]; then
    echo -e "${RED}Found $NPM_VULNS npm vulnerabilities${NC}"
    VULNERABILITIES=$((VULNERABILITIES + NPM_VULNS))

    # Show critical and high vulnerabilities
    echo "Critical vulnerabilities:"
    cat npm-audit-report.json | jq '.vulnerabilities | to_entries[] | select(.value.severity == "critical") | .key' 2>/dev/null || true

    echo "High severity vulnerabilities:"
    cat npm-audit-report.json | jq '.vulnerabilities | to_entries[] | select(.value.severity == "high") | .key' 2>/dev/null || true
else
    echo -e "${GREEN}No npm vulnerabilities found${NC}"
fi

echo ""

# 2. Docker image scanning with Trivy
echo "2. Scanning Docker images for vulnerabilities..."
echo "=============================================="

for service in gateway dms-service loss-analytics-service edge-gateway; do
    echo "Scanning ms5/$service:latest..."

    if docker images | grep -q "ms5/$service"; then
        trivy image --severity HIGH,CRITICAL --format json ms5/$service:latest > trivy-$service.json 2>/dev/null || true

        IMAGE_VULNS=$(cat trivy-$service.json | jq '[.Results[].Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' 2>/dev/null || echo "0")

        if [ "$IMAGE_VULNS" -gt 0 ]; then
            echo -e "${RED}Found $IMAGE_VULNS vulnerabilities in $service image${NC}"
            VULNERABILITIES=$((VULNERABILITIES + IMAGE_VULNS))
        else
            echo -e "${GREEN}No critical vulnerabilities in $service image${NC}"
        fi
    else
        echo -e "${YELLOW}Image ms5/$service not found, skipping${NC}"
    fi
done

echo ""

# 3. Secret scanning
echo "3. Scanning for exposed secrets and credentials..."
echo "================================================"

# Using git-secrets or truffleHog
if command -v trufflehog &> /dev/null; then
    echo "Running TruffleHog scan..."
    trufflehog filesystem . --json > trufflehog-report.json 2>/dev/null || true

    SECRETS_FOUND=$(cat trufflehog-report.json | jq 'length' 2>/dev/null || echo "0")

    if [ "$SECRETS_FOUND" -gt 0 ]; then
        echo -e "${RED}Found $SECRETS_FOUND potential secrets${NC}"
        VULNERABILITIES=$((VULNERABILITIES + SECRETS_FOUND))
    else
        echo -e "${GREEN}No secrets detected${NC}"
    fi
else
    echo -e "${YELLOW}TruffleHog not installed, using basic pattern matching${NC}"

    # Basic pattern matching for common secrets
    PATTERNS=(
        "password.*=.*['\"].*['\"]"
        "api[_-]?key.*=.*['\"].*['\"]"
        "secret.*=.*['\"].*['\"]"
        "token.*=.*['\"].*['\"]"
        "AWS.*=.*['\"].*['\"]"
        "AZURE.*=.*['\"].*['\"]"
    )

    for pattern in "${PATTERNS[@]}"; do
        matches=$(grep -r -E "$pattern" --include="*.ts" --include="*.js" --include="*.json" --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | wc -l)
        if [ "$matches" -gt 0 ]; then
            echo -e "${YELLOW}Found $matches matches for pattern: $pattern${NC}"
            WARNINGS=$((WARNINGS + matches))
        fi
    done
fi

echo ""

# 4. OWASP dependency check
echo "4. Running OWASP dependency check..."
echo "===================================="

if command -v dependency-check &> /dev/null; then
    dependency-check --scan . --format JSON --out owasp-report.json --suppression owasp-suppressions.xml 2>/dev/null || true

    OWASP_VULNS=$(cat owasp-report.json | jq '.dependencies[].vulnerabilities[]? | select(.severity == "HIGH" or .severity == "CRITICAL")' | jq -s 'length' 2>/dev/null || echo "0")

    if [ "$OWASP_VULNS" -gt 0 ]; then
        echo -e "${RED}OWASP found $OWASP_VULNS high/critical vulnerabilities${NC}"
        VULNERABILITIES=$((VULNERABILITIES + OWASP_VULNS))
    else
        echo -e "${GREEN}No critical OWASP vulnerabilities found${NC}"
    fi
else
    echo -e "${YELLOW}OWASP dependency-check not installed${NC}"
fi

echo ""

# 5. Kubernetes security scanning
echo "5. Scanning Kubernetes manifests..."
echo "==================================="

if command -v kubesec &> /dev/null; then
    for manifest in infra/k8s/*.yaml; do
        if [ -f "$manifest" ]; then
            echo "Scanning $manifest..."
            kubesec scan "$manifest" > kubesec-$(basename "$manifest").json 2>/dev/null || true

            SCORE=$(cat kubesec-$(basename "$manifest").json | jq '.[0].score' 2>/dev/null || echo "0")

            if [ "$SCORE" -lt 0 ]; then
                echo -e "${RED}Security score: $SCORE (Critical issues found)${NC}"
                VULNERABILITIES=$((VULNERABILITIES + 1))
            elif [ "$SCORE" -lt 5 ]; then
                echo -e "${YELLOW}Security score: $SCORE (Room for improvement)${NC}"
                WARNINGS=$((WARNINGS + 1))
            else
                echo -e "${GREEN}Security score: $SCORE (Good)${NC}"
            fi
        fi
    done
else
    echo -e "${YELLOW}kubesec not installed${NC}"
fi

echo ""

# 6. SSL/TLS configuration check
echo "6. Checking SSL/TLS configuration..."
echo "===================================="

# Check for weak ciphers in configurations
WEAK_CIPHERS=(
    "SSL2"
    "SSL3"
    "TLS1.0"
    "TLS1.1"
    "RC4"
    "MD5"
    "DES"
    "3DES"
)

for cipher in "${WEAK_CIPHERS[@]}"; do
    matches=$(grep -r "$cipher" --include="*.yaml" --include="*.yml" --include="*.conf" --exclude-dir=node_modules . 2>/dev/null | wc -l)
    if [ "$matches" -gt 0 ]; then
        echo -e "${YELLOW}Found references to weak cipher: $cipher${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
done

echo ""

# 7. Authentication and authorisation checks
echo "7. Checking authentication configuration..."
echo "=========================================="

# Check for default credentials
DEFAULT_CREDS=(
    "admin:admin"
    "root:root"
    "test:test"
    "demo:demo"
)

for cred in "${DEFAULT_CREDS[@]}"; do
    matches=$(grep -r "$cred" --include="*.ts" --include="*.js" --include="*.env*" --exclude-dir=node_modules . 2>/dev/null | wc -l)
    if [ "$matches" -gt 0 ]; then
        echo -e "${RED}Found potential default credential: $cred${NC}"
        VULNERABILITIES=$((VULNERABILITIES + 1))
    fi
done

# Check for JWT configuration
JWT_ISSUES=0

# Check for hardcoded JWT secrets
if grep -r "JWT.*SECRET.*=.*['\"]" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null | grep -v "process.env"; then
    echo -e "${RED}Found hardcoded JWT secrets${NC}"
    JWT_ISSUES=$((JWT_ISSUES + 1))
fi

# Check for weak JWT algorithms
if grep -r "algorithm.*:.*['\"]HS256['\"]" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null; then
    echo -e "${YELLOW}Using HS256 algorithm (consider RS256 for production)${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

if [ "$JWT_ISSUES" -eq 0 ]; then
    echo -e "${GREEN}JWT configuration looks secure${NC}"
fi

echo ""

# 8. API security checks
echo "8. Checking API security..."
echo "=========================="

# Check for rate limiting
if grep -r "rate.*limit" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null | wc -l | grep -q "^0$"; then
    echo -e "${YELLOW}No rate limiting configuration found${NC}"
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}Rate limiting configured${NC}"
fi

# Check for CORS configuration
if grep -r "cors" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null | wc -l | grep -q "^0$"; then
    echo -e "${YELLOW}No CORS configuration found${NC}"
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}CORS configured${NC}"
fi

# Check for input validation
if grep -r "zod\|joi\|yup\|express-validator" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null | wc -l | grep -q "^0$"; then
    echo -e "${YELLOW}No input validation library detected${NC}"
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}Input validation library detected${NC}"
fi

echo ""

# 9. Generate security report
echo "========================================"
echo "Security Scan Summary"
echo "========================================"

if [ "$VULNERABILITIES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    echo -e "${GREEN}✓ No security issues found!${NC}"
    EXIT_CODE=0
elif [ "$VULNERABILITIES" -eq 0 ]; then
    echo -e "${YELLOW}⚠ Found $WARNINGS warnings (no critical issues)${NC}"
    EXIT_CODE=0
else
    echo -e "${RED}✗ Found $VULNERABILITIES vulnerabilities and $WARNINGS warnings${NC}"
    EXIT_CODE=1
fi

# Generate JSON report
cat > security-scan-report.json <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "vulnerabilities": $VULNERABILITIES,
  "warnings": $WARNINGS,
  "npm_vulnerabilities": $NPM_VULNS,
  "docker_vulnerabilities": $(find . -name "trivy-*.json" -exec cat {} \; | jq -s '[.[].Results[].Vulnerabilities[]? | select(.Severity == "HIGH" or .Severity == "CRITICAL")] | length' 2>/dev/null || echo "0"),
  "secrets_found": ${SECRETS_FOUND:-0},
  "status": $([ "$EXIT_CODE" -eq 0 ] && echo '"passed"' || echo '"failed"')
}
EOF

echo ""
echo "Detailed reports saved to:"
echo "  - npm-audit-report.json"
echo "  - trivy-*.json"
echo "  - security-scan-report.json"

exit $EXIT_CODE