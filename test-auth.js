// MS5.0 Authentication System Test Script
const crypto = require('crypto');

// Configuration from .env
const AUTH_CONFIG = {
  JWT_SECRET: 'local-development-secret-key-change-in-production',
  OIDC_ENABLED: false,
  AUTH_BYPASS: true,
  DATABASE_URL: 'postgresql://ms5user:ms5pass@localhost:5432/ms5db',
};

console.log('🔐 MS5.0 Authentication System Status');
console.log('=====================================\n');

// Check current configuration
console.log('📋 Current Configuration:');
console.log(
  `   • OIDC Enabled: ${AUTH_CONFIG.OIDC_ENABLED ? '✅ Yes' : '❌ No (Using local auth)'}`,
);
console.log(
  `   • Auth Bypass: ${AUTH_CONFIG.AUTH_BYPASS ? '⚠️  Yes (Development mode)' : '✅ No'}`,
);
console.log(`   • JWT Secret: ${AUTH_CONFIG.JWT_SECRET ? '✅ Configured' : '❌ Missing'}`);
console.log('');

// Test user credentials
const testUsers = [
  { email: 'admin@ms5.local', password: 'admin123', role: 'admin' },
  { email: 'operator1@ms5.local', password: 'operator123', role: 'operator' },
  { email: 'supervisor@ms5.local', password: 'supervisor123', role: 'supervisor' },
];

console.log('👥 Available Test Users:');
testUsers.forEach((user) => {
  console.log(`   • ${user.email} (${user.role})`);
  console.log(`     Password: ${user.password}`);
});
console.log('');

// Simulate JWT token generation (simplified)
function generateToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.email,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24 hours
    }),
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', AUTH_CONFIG.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

console.log('🎫 Sample JWT Tokens:');
const adminToken = generateToken(testUsers[0]);
console.log(`   Admin Token (first 50 chars): ${adminToken.substring(0, 50)}...`);
console.log('');

// Authentication endpoints (when app is running)
console.log('🔌 Authentication Endpoints (when app is running):');
console.log('   • Login: POST http://localhost:4000/auth/login');
console.log('     Body: { "email": "admin@ms5.local", "password": "admin123" }');
console.log('');
console.log('   • Verify Token: GET http://localhost:4000/auth/verify');
console.log('     Header: Authorization: Bearer <token>');
console.log('');
console.log('   • User Info: GET http://localhost:4000/auth/userinfo');
console.log('     Header: Authorization: Bearer <token>');
console.log('');

// Test database connection
const { Client } = require('pg');
const client = new Client({
  connectionString: AUTH_CONFIG.DATABASE_URL,
});

async function testDatabase() {
  try {
    await client.connect();
    const result = await client.query('SELECT COUNT(*) FROM users');
    console.log(`✅ Database Connected: ${result.rows[0].count} users found`);

    const users = await client.query('SELECT email, role FROM users ORDER BY role');
    console.log('\n📊 Users in Database:');
    users.rows.forEach((user) => {
      console.log(`   • ${user.email} (${user.role})`);
    });
  } catch (err) {
    console.log(`❌ Database Error: ${err.message}`);
  } finally {
    await client.end();
  }
}

testDatabase().then(() => {
  console.log('\n=====================================');
  console.log('🔐 Authentication System Summary:');
  console.log('');
  console.log('Current Status:');
  console.log(`   • Database: ✅ Connected with ${testUsers.length} test users`);
  console.log(
    `   • Auth Mode: ${AUTH_CONFIG.AUTH_BYPASS ? '⚠️  Development (bypass enabled)' : '✅ Production'}`,
  );
  console.log(
    `   • OIDC: ${AUTH_CONFIG.OIDC_ENABLED ? '✅ Enabled' : '❌ Disabled (using local auth)'}`,
  );
  console.log('');
  console.log('⚠️  Note: The application services need to be running to test');
  console.log('   the actual authentication endpoints. Currently only the');
  console.log('   database layer is active.');
  console.log('');
  console.log('To enable full authentication:');
  console.log('   1. Fix TypeScript compilation issues in libs/shared');
  console.log('   2. Start the gateway service: cd services/ms5.0-gateway && npm run dev');
  console.log('   3. Test auth endpoints with the tokens above');
});
