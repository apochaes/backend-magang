module.exports = {
  apps: [
    {
      name: "backend-3000",
      script: "src/server.js",
      env: {
        PORT: 3000,
      },
    },
    {
      name: "backend-3001",
      script: "src/server.js",
      env: {
        PORT: 3001,
      },
    },
    {
      name: "backend-3002",
      script: "src/server.js",
      env: {
        PORT: 3002,
      },
    },
  ],
};
