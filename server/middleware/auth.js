import crypto from 'node:crypto';
import { config } from '../config.js';

// Nonce cache for replay attack prevention within timestamp window
const seenNonces = new Map();

// Periodic cleanup of expired nonces (every 5 minutes)
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const [nonce, timestamp] of seenNonces.entries()) {
    if (timestamp < cutoff) {
      seenNonces.delete(nonce);
    }
  }
}, 300000).unref();

export function verifyBotAuth(req, res, next) {
  // Option 1: Bearer Token (strictly allowed ONLY in development and testing)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (config.isProduction) {
      return res.status(403).json({
        error: 'BEARER_DISABLED_IN_PRODUCTION',
        message: 'Bearer token authentication is disabled in production. HMAC-SHA256 headers are required.'
      });
    }

    const token = authHeader.slice(7).trim();
    if (safeCompare(token, config.botApiSecret)) {
      req.authMethod = 'bearer';
      return next();
    }
  }

  // Option 2: HMAC-SHA256 Signature (Production-grade)
  const timestampHeader = req.headers['x-bot-timestamp'];
  const nonce = req.headers['x-bot-nonce'];
  const signature = req.headers['x-bot-signature'];

  if (!timestampHeader || !nonce || !signature) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing bot authentication credentials (x-bot-timestamp, x-bot-nonce, x-bot-signature required)'
    });
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    return res.status(401).json({
      error: 'INVALID_TIMESTAMP',
      message: 'Timestamp header must be a valid integer epoch ms'
    });
  }

  // Check clock drift (max 5 minutes)
  const drift = Math.abs(Date.now() - timestamp);
  if (drift > 300000) {
    return res.status(401).json({
      error: 'TIMESTAMP_EXPIRED',
      message: 'Request timestamp is outside the acceptable 5-minute window'
    });
  }

  // Replay prevention: Check if nonce was already seen
  if (seenNonces.has(nonce)) {
    return res.status(401).json({
      error: 'NONCE_REPLAY_DETECTED',
      message: 'This nonce has already been processed'
    });
  }

  // Verify HMAC signature
  const bodyString = req.rawBody !== undefined && req.rawBody !== '' 
    ? req.rawBody 
    : (req.method === 'GET' ? '' : JSON.stringify(req.body || {}));
  const hmac = crypto.createHmac('sha256', config.botApiSecret);
  hmac.update(`${timestamp}.${nonce}.${bodyString}`);
  const expectedSignature = hmac.digest('hex');

  if (!safeCompare(signature.toLowerCase(), expectedSignature.toLowerCase())) {
    return res.status(401).json({
      error: 'INVALID_SIGNATURE',
      message: 'HMAC signature verification failed'
    });
  }

  // Store nonce to prevent replay
  seenNonces.set(nonce, timestamp);
  req.authMethod = 'hmac';
  next();
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
