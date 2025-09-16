const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Database connection with retry
const pgPool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ms5db',
  user: process.env.DB_USER || 'ms5user',
  password: process.env.DB_PASSWORD || 'ms5secure2025',
  max: 20,
  connectionTimeoutMillis: 10000,
});

// Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Wait for database connection
async function waitForDatabase() {
  let retries = 30;
  while (retries > 0) {
    try {
      await pgPool.query('SELECT 1');
      console.log('✅ Database connected');
      return;
    } catch (err) {
      console.log(`Waiting for database... (${retries} retries left)`);
      retries--;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Could not connect to database');
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'MS5.0 Manufacturing System'
  });
});

app.get('/api/v2/metrics', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT COUNT(*) FROM production_lines');
    res.json({
      production_lines: result.rows[0].count,
      status: 'operational',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v2/lines', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM production_lines ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v2/assets', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM assets ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v2/telemetry', async (req, res) => {
  try {
    const { asset_id, temperature, pressure, vibration, speed } = req.body;
    const result = await pgPool.query(
      'INSERT INTO telemetry (asset_id, temperature, pressure, vibration, speed) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [asset_id, temperature, pressure, vibration, speed]
    );

    // Cache in Redis
    await redis.setex(
      `telemetry:${result.rows[0].id}`,
      300,
      JSON.stringify(req.body)
    );

    res.json({ id: result.rows[0].id, status: 'recorded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
async function start() {
  try {
    await waitForDatabase();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════════════════╗
║   MS5.0 Manufacturing System - API Gateway          ║
║   Running on port ${PORT}                               ║
║   Health check: http://localhost:${PORT}/health         ║
╚══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
