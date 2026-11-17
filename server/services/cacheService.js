/**
 * In-Memory LRU / TTL Cache Service.
 * Provides microsecond-level caching in serverless Node.js memory.
 */

class MemoryCache {
  constructor(defaultTtlMs = 60000) {
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    // Keep max size bounded to prevent memory leaks in long-running processes
    if (this.cache.size > 2000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

export const catalogCache = new MemoryCache(600000); // 10 minutes for catalog
export const searchCache = new MemoryCache(30000);   // 30 seconds for search
export const playerCache = new MemoryCache(10000);   // 10 seconds for player record
export const profileResponseCache = new MemoryCache(10000); // 10 seconds for full player profile payload
