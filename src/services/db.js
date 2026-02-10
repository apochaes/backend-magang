const { Pool } = require("pg");

console.log("DB CONFIG READ:", {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // CRITICAL: Connection pool configuration
  max: 20, // max 20 connections per instance (9 instances x 20 = 180 total)
  min: 5, // maintain 5 idle connections
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: 10000, // fail fast if can't get connection in 10s
  maxUses: 7500, // recycle connection after 7500 uses (prevent memory leaks)

  // Query timeout
  statement_timeout: 10000, // kill queries that run > 10s
  query_timeout: 10000,

  // Keepalive settings (prevent firewall/LB from closing idle connections)
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Error handling
pool.on("error", (err, client) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

pool.on("connect", (client) => {
  console.log(`PostgreSQL connection established (PID: ${process.pid})`);
});

pool.on("remove", (client) => {
  console.log(`PostgreSQL connection removed (PID: ${process.pid})`);
});

// Test connection on startup
pool
  .connect()
  .then((client) => {
    console.log("PostgreSQL pool initialized successfully");
    client.release();
  })
  .catch((err) => console.error("PostgreSQL connection error:", err.message));

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing PostgreSQL pool...");
  await pool.end();
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing PostgreSQL pool...");
  await pool.end();
});

module.exports = pool;
