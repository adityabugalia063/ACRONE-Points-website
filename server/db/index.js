import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { config, validateProductionConfig } from '../config.js';
import { initSchema } from './schema.js';
import { seedCatalog } from './seed.js';

let clientInstance = null;
let initPromise = null;

export { getDbClient as getDb };

/**
 * Returns the libSQL / Turso database client.
 * Connects to Turso Cloud in production or local SQLite in development.
 */
export function getDbClient() {
  if (clientInstance) return clientInstance;

  validateProductionConfig();

  if (config.tursoDatabaseUrl) {
    clientInstance = createClient({
      url: config.tursoDatabaseUrl,
      authToken: config.tursoAuthToken || undefined
    });
  } else {
    // Local development SQLite file
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const normalized = path.resolve(config.dbPath).replace(/\\/g, '/');
    const fileUrl = 'file:' + (normalized.startsWith('/') ? normalized : '/' + normalized);
    clientInstance = createClient({ url: fileUrl });
  }

  return clientInstance;
}

/**
 * Ensures schema and initial catalogue metadata are present.
 * Thread-safe / idempotent: runs once per process.
 */
export async function ensureDbReady() {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getDbClient();
      await initSchema(client);
      await seedCatalog(client);
      return client;
    })();
  }
  return initPromise;
}

/**
 * Helper: Query a single row with parameterized arguments
 */
export async function queryOne(sql, args = []) {
  const client = getDbClient();
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}

/**
 * Helper: Query multiple rows with parameterized arguments
 */
export async function queryAll(sql, args = []) {
  const client = getDbClient();
  const res = await client.execute({ sql, args });
  return res.rows;
}

/**
 * Helper: Execute an insert/update/delete with parameterized arguments
 */
export async function execute(sql, args = []) {
  const client = getDbClient();
  return client.execute({ sql, args });
}

/**
 * Helper: Execute within an explicit database transaction
 */
export async function withTransaction(callback) {
  const client = getDbClient();
  const txn = await client.transaction('write');
  try {
    const result = await callback(txn);
    await txn.commit();
    return result;
  } catch (err) {
    await txn.rollback();
    throw err;
  } finally {
    txn.close();
  }
}

/**
 * Closes the database client connection.
 */
export function closeDb() {
  if (clientInstance) {
    try {
      clientInstance.close();
    } catch (_) {}
    clientInstance = null;
    initPromise = null;
  }
}
