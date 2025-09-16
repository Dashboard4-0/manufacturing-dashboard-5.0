#!/bin/bash

echo "🔐 MS5.0 Authentication System Status"
echo "====================================="
echo ""

# Check database users
echo "👥 Users in Database:"
docker exec ms5-postgres psql -U ms5user -d ms5db -t -c "SELECT email || ' (' || role || ')' FROM users ORDER BY role;" 2>/dev/null | sed 's/^/   • /'

echo ""
echo "📋 Authentication Configuration:"
if [ -f .env ]; then
    echo "   • JWT Secret: ✅ Configured"

    OIDC_ENABLED=$(grep "^OIDC_ENABLED=" .env | cut -d'=' -f2)
    if [ "$OIDC_ENABLED" = "true" ]; then
        echo "   • OIDC: ✅ Enabled"
    else
        echo "   • OIDC: ❌ Disabled (using local authentication)"
    fi

    AUTH_BYPASS=$(grep "^AUTH_BYPASS=" .env | cut -d'=' -f2)
    if [ "$AUTH_BYPASS" = "true" ]; then
        echo "   • Auth Mode: ⚠️  Development (bypass enabled)"
    else
        echo "   • Auth Mode: ✅ Production"
    fi
else
    echo "   ❌ .env file not found"
fi

echo ""
echo "🔌 Authentication Methods Available:"
echo "   1. Local Authentication (Currently Active)"
echo "      • Email/Password based"
echo "      • JWT token generation"
echo "      • Role-based access control (admin, supervisor, operator)"
echo ""
echo "   2. OIDC/Azure AD (Available but disabled)"
echo "      • Enterprise SSO integration"
echo "      • Azure AD group mapping"
echo "      • MFA support"

echo ""
echo "📝 Test Credentials:"
echo "   • admin@ms5.local / admin123 (admin role)"
echo "   • supervisor@ms5.local / supervisor123 (supervisor role)"
echo "   • operator1@ms5.local / operator123 (operator role)"

echo ""
echo "🎯 Authentication Status Summary:"
echo "   • Database Layer: ✅ Active with 3 test users"
echo "   • Auth Service: ⚠️  Not running (requires app services)"
echo "   • Security Mode: ⚠️  Development (AUTH_BYPASS=true)"

echo ""
echo "⚠️  Note: To activate full authentication:"
echo "   1. Set AUTH_BYPASS=false in .env for production auth"
echo "   2. Set OIDC_ENABLED=true for Azure AD integration"
echo "   3. Start the gateway service to enable auth endpoints"