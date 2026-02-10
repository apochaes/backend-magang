const express = require("express");
const reportsRoute = require("./routes/reports");

const app = express();

// Trust proxy (penting untuk NGINX load balancer)
app.set("trust proxy", 1);

// Body parser with limits
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request timeout middleware
app.use((req, res, next) => {
  // Set timeout to 25 seconds (less than nginx timeout)
  req.setTimeout(25000, () => {
    res.status(408).json({ message: "Request timeout" });
  });
  res.setTimeout(25000, () => {
    res.status(408).json({ message: "Response timeout" });
  });
  next();
});

const apiRouter = express.Router();

// health check (untuk nginx / load balancer)
apiRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "backend",
    port: process.env.PORT,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// reports API
apiRouter.use("/reports", reportsRoute);

app.use("/api", apiRouter);

app.get("/", (req, res) => {
  res.send("Backend running");
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err.stack);

  // Don't leak error details in production
  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message;

  res.status(err.status || 500).json({
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

module.exports = app;
