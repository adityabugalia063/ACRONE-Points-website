import app from '../server/index.js';

/**
 * Vercel Serverless Function entry point.
 * 
 * When Vercel rewrites incoming API requests (e.g., from /api/(.*) to /api/index.js),
 * the internal invocation target received by the serverless function can be `/api/index.js`.
 * 
 * This handler inspects:
 * 1. The explicit `__path` query parameter passed by vercel.json rewrite
 * 2. Standard Vercel routing headers: `x-matched-path`, `x-forwarded-uri`, `x-invoke-path`
 * 3. Vercel route match capture group headers: `x-now-route-matches`
 * 
 * It restores the true incoming pathname and query parameters onto `req.url` and `req.originalUrl`
 * before delegating to the universal application handler, ensuring all existing routes,
 * methods, request bodies, and authentication work seamlessly on Vercel.
 */
export default async function handler(req, res) {
  try {
    const rawUrl = req.url || '/';
    const host = req.headers?.host || 'localhost';
    const parsed = new URL(rawUrl, `http://${host}`);

    let targetPath = null;

    // 1. Check for explicit path parameter populated by vercel.json rewrite
    if (parsed.searchParams.has('__path')) {
      targetPath = parsed.searchParams.get('__path');
      parsed.searchParams.delete('__path');
    }

    // 2. Fallback to Vercel routing headers if __path was not present
    if (!targetPath) {
      const matched = req.headers?.['x-matched-path'] || req.headers?.['x-forwarded-uri'] || req.headers?.['x-invoke-path'];
      if (matched && typeof matched === 'string') {
        const matchedParsed = new URL(matched, `http://${host}`);
        if (matchedParsed.pathname && !matchedParsed.pathname.startsWith('/api/index')) {
          targetPath = matchedParsed.pathname;
          // Merge any query params from matched path that might be missing
          for (const [k, v] of matchedParsed.searchParams.entries()) {
            if (!parsed.searchParams.has(k)) {
              parsed.searchParams.set(k, v);
            }
          }
        }
      }
    }

    // 3. Fallback to Vercel regex route match capture group (e.g. 1=v1/bot/health)
    if (!targetPath && req.headers?.['x-now-route-matches'] && typeof req.headers['x-now-route-matches'] === 'string') {
      try {
        const matchParams = new URLSearchParams(req.headers['x-now-route-matches']);
        const capture = matchParams.get('1') || matchParams.get('0');
        if (capture) {
          targetPath = `/api/${decodeURIComponent(capture)}`;
        }
      } catch (_) {}
    }

    // 4. Restore req.url if an original target path was determined
    if (targetPath) {
      if (!targetPath.startsWith('/')) {
        targetPath = '/' + targetPath;
      }
      const search = parsed.search; // Preserves remaining query parameters (e.g. ?query=Collector)
      req.url = `${targetPath}${search}`;
      req.originalUrl = req.url;
    }
  } catch (err) {
    console.warn('URL restoration warning in api/index.js:', err);
  }

  // Pass to universal application handler
  return app(req, res);
}

export { app };
