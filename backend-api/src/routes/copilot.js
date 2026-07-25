const express = require('express');
const axios = require('axios');
const router = express.Router();

// Retrieve FastAPI AI Engine URL from environment
const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

/**
 * Helper to proxy requests to the AI engine
 */
async function proxyToAIEngine(endpoint, req, res) {
  try {
    const targetUrl = `${AI_ENGINE_URL}${endpoint}`;
    
    // Forward the request body and any query parameters
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      params: req.query,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 60000 // 60s timeout for LLM generation/healing
    });

    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`Error forwarding request to AI Engine (${endpoint}):`, error.message);
    
    if (error.response) {
      // The AI Engine responded with a non-2xx status code
      return res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      // The request was made but no response was received (e.g. AI Engine down)
      return res.status(502).json({
        error: 'Bad Gateway',
        message: 'AI Engine service is currently unreachable'
      });
    } else {
      // General error
      return res.status(500).json({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }
}

/**
 * POST /api/copilot/introspect
 * Proxy database schema introspection requests to AI Engine
 */
router.post('/introspect', (req, res) => {
  proxyToAIEngine('/api/introspect', req, res);
});

/**
 * POST /api/copilot/query
 * Proxy natural language queries + db connection requests to AI Engine
 */
router.post('/query', (req, res) => {
  proxyToAIEngine('/api/query', req, res);
});

/**
 * GET /api/copilot/config/key/status
 * Get the current Gemini API Key configuration status
 */
router.get('/config/key/status', (req, res) => {
  proxyToAIEngine('/api/config/key/status', req, res);
});

/**
 * POST /api/copilot/config/key/test
 * Test if a given Gemini API Key is valid
 */
router.post('/config/key/test', (req, res) => {
  proxyToAIEngine('/api/config/key/test', req, res);
});

/**
 * POST /api/copilot/config/key
 * Update and reload the Gemini API Key
 */
router.post('/config/key', (req, res) => {
  proxyToAIEngine('/api/config/key', req, res);
});

module.exports = router;
