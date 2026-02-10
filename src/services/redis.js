const redis = require("redis");
require("dotenv").config();

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = process.env.REDIS_PORT || "6379";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || "";

const redisUrl = REDIS_PASSWORD
  ? `redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`
  : `redis://${REDIS_HOST}:${REDIS_PORT}`;

const redisClient = redis.createClient({
  url: redisUrl,
  socket: {
    // Connection pooling settings
    connectTimeout: 10000, // 10s timeout
    keepAlive: 5000, // keepalive every 5s
    noDelay: true, // disable Nagle's algorithm for low latency
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error("Redis: Too many reconnection attempts, giving up");
        return new Error("Redis reconnection failed");
      }
      // Exponential backoff: 50ms, 100ms, 200ms, 400ms...
      return Math.min(retries * 50, 3000);
    },
  },
  // Performance settings
  enableOfflineQueue: true, // Queue commands when disconnected
  enableReadyCheck: true, // Ensure connection is ready
  maxRetriesPerRequest: 3, // Retry failed commands 3 times
});

redisClient.on("connect", () => {
  console.log(
    `Redis connecting to: ${redisUrl.replace(/:\/\/:.+@/, "://:***@")}`,
  );
});

redisClient.on("ready", () => {
  console.log(`Redis ready (PID: ${process.pid})`);
});

redisClient.on("error", (err) => {
  console.error(`Redis error (PID: ${process.pid}):`, err.message);
});

redisClient.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

redisClient.on("end", () => {
  console.log("Redis connection closed");
});

// Initialize connection
(async () => {
  try {
    await redisClient.connect();
    console.log("Redis connected successfully");
  } catch (err) {
    console.error("Failed to connect to Redis:", err.message);
    // Don't crash the app, just log the error
  }
})();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing Redis connection...");
  await redisClient.quit();
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing Redis connection...");
  await redisClient.quit();
});

// Helper function to safely execute Redis commands
async function safeRedisCommand(command, ...args) {
  if (!redisClient.isOpen) {
    console.warn("Redis is not connected, skipping command:", command);
    return null;
  }

  try {
    return await redisClient[command](...args);
  } catch (err) {
    console.error(`Redis ${command} error:`, err.message);
    return null;
  }
}

module.exports = { redisClient, safeRedisCommand };
