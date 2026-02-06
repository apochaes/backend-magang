const express = require('express');
const reportsRoute = require('./routes/reports');

const app = express();
app.use(express.json());

const apiRouter = express.Router();

// health check (buat nginx / load balancer test)
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'backend',
    port: process.env.PORT,
    pid: process.pid
  });
});

// reports API
apiRouter.use('/reports', reportsRoute);

app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.send('Backend running');
});

module.exports = app;

