require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const authMiddleware = require('./middleware/auth');
const apiLimiter = require('./middleware/rateLimiter');
const copilotRoutes = require('./routes/copilot');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend requests
app.use(cors({
  origin: '*', // Allow all origins for development; restrict in production
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Request logger
app.use(morgan('dev'));

// JSON parsing middleware
app.use(express.json({ limit: '10mb' }));

// Public Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'API Gateway',
    timestamp: new Date().toISOString()
  });
});

// Protected Copilot Routes
// Apply API Key Authentication and Rate Limiting
app.use('/api/copilot', authMiddleware, apiLimiter, copilotRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.originalUrl} not found` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Gateway Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred in the gateway'
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 Gateway Server running on port ${PORT}`);
  console.log(`🔐 Protecting routes with API Key Auth`);
  console.log(`⏳ Rate limiting enabled (100 req / 15m)`);
  console.log(`=========================================`);
});
