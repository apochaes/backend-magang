const express = require('express');
const reportsRoute = require('./routes/reports');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend' });
});

app.use('/reports', reportsRoute);

module.exports = app;
