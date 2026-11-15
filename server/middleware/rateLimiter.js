/**
 * In-Memory Sliding Window Rate Limiter
 * Protects public and bot endpoints from brute force and denial of service.
 */

class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();

    // Clean up expired buckets every 2 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, timestamps] of this.hits.entries()) {
        const valid = timestamps.filter((t) => now - t < this.windowMs);
        if (valid.length === 0) {
          this.hits.delete(ip);
        } else {
          this.hits.set(ip, valid);
        }
      }
    }, 120000);
    this.cleanupInterval.unref();
  }

  getMiddleware(customLimit = null) {
    const limit = customLimit || this.maxRequests;

    return (req, res, next) => {
      // Determine client IP
      const forwarded = req.headers['x-forwarded-for'];
      const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) ||
                 req.socket?.remoteAddress ||
                 '127.0.0.1';

      const now = Date.now();
      let timestamps = this.hits.get(ip) || [];

      // Filter to window
      timestamps = timestamps.filter((t) => now - t < this.windowMs);

      if (timestamps.length >= limit) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': Math.ceil(this.windowMs / 1000)
        });
        res.end(
          JSON.stringify({
            error: 'TOO_MANY_REQUESTS',
            message: `Rate limit exceeded. Maximum ${limit} requests per minute allowed.`
          })
        );
        return;
      }

      timestamps.push(now);
      this.hits.set(ip, timestamps);
      next();
    };
  }
}

export const publicRateLimiter = new RateLimiter(60000, 120).getMiddleware();
export const botRateLimiter = new RateLimiter(60000, 240).getMiddleware();
