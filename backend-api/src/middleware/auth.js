/**
 * Auth Middleware
 * Verifies that requests include a valid API key in the headers.
 */
function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.GATEWAY_API_KEY || 'dev-secret-key-123';

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key in x-api-key header'
    });
  }

  next();
}

module.exports = authMiddleware;
