import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple native .env loader without external dependencies
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch (e) {
      console.warn('Could not read .env file:', e.message);
    }
  }
}

loadEnv();

const isProduction = process.env.NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  isVercel,
  botApiSecret: process.env.BOT_API_SECRET || (isProduction ? '' : 'acrone_dev_secret_change_in_production_998877'),
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../data/acrone_collection.db'),
  siteBaseUrl: process.env.SITE_BASE_URL || 'http://localhost:3000',
  allowIndexing: process.env.ALLOW_SEARCH_INDEXING === 'true',
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],
  publicStaticDir: path.resolve(__dirname, '../public')
};

/**
 * Validates configuration for production deployment.
 * Fails fast if critical secrets or database credentials are missing.
 */
export function validateProductionConfig() {
  if (config.isProduction) {
    if (!config.botApiSecret || config.botApiSecret === 'acrone_dev_secret_change_in_production_998877') {
      throw new Error(
        'FATAL: BOT_API_SECRET is missing, empty, or using the insecure default value. Production deployment aborted.'
      );
    }

    if (!config.tursoDatabaseUrl) {
      throw new Error(
        'FATAL: TURSO_DATABASE_URL is missing. Production deployment must use Turso Cloud / libSQL and cannot fall back to a local database.'
      );
    }

    if (!config.tursoDatabaseUrl.startsWith('libsql://') && !config.tursoDatabaseUrl.startsWith('https://')) {
      throw new Error(
        `FATAL: Invalid TURSO_DATABASE_URL '${config.tursoDatabaseUrl}'. Must start with libsql:// or https:// in production.`
      );
    }

    if (!config.tursoAuthToken) {
      throw new Error(
        'FATAL: TURSO_AUTH_TOKEN is missing. Provide a valid Turso authentication token in production.'
      );
    }
  }
}
