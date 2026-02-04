const redis = require("redis");
require("dotenv").config();

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = process.env.REDIS_PORT || "6379";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || "";

const redisUrl = REDIS_PASSWORD
  ? `redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`
  : `redis://${REDIS_HOST}:${REDIS_PORT}`;

const redisClient = redis.createClient({ url: redisUrl });

redisClient.on("connect", () => {
  console.log("Redis connected to:", redisUrl.replace(/:\/\/:.+@/, "://:***@"));
});

redisClient.on("error", (err) => {
  console.error("Redis error", err);
});

(async () => {
  await redisClient.connect();
})();

module.exports = redisClient;
