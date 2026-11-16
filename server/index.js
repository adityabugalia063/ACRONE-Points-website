import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { config, validateProductionConfig } from './config.js';
import { ensureDbReady, closeDb } from './db/index.js';
import { Router } from './router.js';
import { registerBotRoutes } from './routes/botRoutes.js';
import { registerPublicRoutes } from './routes/publicRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate environment on startup
validateProductionConfig();

export const router = new Router();

// 1. Global Middleware: CORS & Security Headers
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Bot-Timestamp, X-Bot-Nonce, X-Bot-Signature'
  );

  // Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // SEO Indexing toggle
  if (config.allowIndexing) {
    res.setHeader('X-Robots-Tag', 'index, follow');
  } else {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});

// 2. Global Middleware: Body Parser for POST/PUT requests
router.use((req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return next();
  }

  // If already parsed by host environment
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    if (!req.rawBody) {
      req.rawBody = JSON.stringify(req.body);
    }
    return next();
  }

  let bodyData = '';
  req.on('data', (chunk) => {
    bodyData += chunk;
    // 1MB request size limit protection
    if (bodyData.length > 1e6) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeded 1MB limit' }));
      req.destroy();
    }
  });

  req.on('end', () => {
    req.rawBody = bodyData;
    if (bodyData) {
      try {
        req.body = JSON.parse(bodyData);
      } catch (err) {
        req.body = {};
      }
    } else {
      req.body = {};
    }
    next();
  });
});

// Register all API routes
registerBotRoutes(router);
registerPublicRoutes(router);

// MIME type map for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendStatic(req, res, filePath, contentType, cacheControl = 'public, max-age=86400') {
  if (res.headersSent || res.writableEnded) return;

  const acceptEncoding = (req.headers && req.headers['accept-encoding']) || '';
  const isCompressible = /^(text\/|application\/javascript|application\/json|image\/svg\+xml)/.test(contentType);
  const useGzip = isCompressible && /\bgzip\b/.test(acceptEncoding);

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl
  };

  if (useGzip) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(zlib.createGzip({ level: 6 })).pipe(res);
  } else {
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  }
}

/**
 * Universal request handler function.
 * Used both in standalone Node.js server and Vercel Serverless Function entrypoint.
 */
export async function app(req, res) {
  try {
    // Ensure DB is initialized
    await ensureDbReady();

    // 1. Attempt API Router match first
    const handled = await router.handle(req, res);
    if (handled || res.headersSent || res.writableEnded) {
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 2. Static Asset Handling (Local development and standalone server)
    const publicDir = config.publicStaticDir;
    const filePath = path.join(publicDir, pathname);

    // Prevent directory traversal
    if (filePath.startsWith(publicDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
      sendStatic(req, res, filePath, contentType, cacheControl);
      return;
    }

    // 3. Fallback for public web client (SPA routing for /u/* and /)
    if (pathname === '/' || pathname.startsWith('/u/')) {
      const indexPath = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        sendStatic(req, res, indexPath, 'text/html; charset=utf-8', 'no-cache');
        return;
      }
    }

    // 4. 404 Handler
    if (!res.headersSent && !res.writableEnded) {
      if (pathname.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'NOT_FOUND', message: `Endpoint ${pathname} does not exist` }));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><body style="background:#09090C;color:#F4F4F6;font-family:sans-serif;text-align:center;padding:50px;">
          <h1 style="color:#D83C53;">404 — Page Not Found</h1>
          <p>The requested page or asset does not exist.</p>
          <a href="/" style="color:#D83C53;text-decoration:none;">Return to Collection</a>
        </body></html>`);
      }
    }
  } catch (err) {
    console.error('Unhandled Server Error:', err);
    if (!res.headersSent && !res.writableEnded) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message: err.message }));
      } catch (_) {}
    }
  }
}

export function createServer() {
  return http.createServer(app);
}

// Start server if executed directly
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  const server = createServer();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 Collection Server running at http://localhost:${config.port}`);
    console.log(`📦 Database loaded: ${config.tursoDatabaseUrl ? 'Turso Cloud' : config.dbPath}`);
    console.log(`⚡ Real-time SSE enabled`);
  });

  const cleanup = () => {
    console.log('\nShutting down server...');
    server.close(() => {
      closeDb();
      console.log('Database connection closed. Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

export default app;
