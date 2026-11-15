import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let dbInstance = null;

export function getDb() {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new DatabaseSync(config.dbPath);
  
  // High performance & data integrity settings
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA synchronous = NORMAL;');

  initSchema(dbInstance);

  return dbInstance;
}

export function initSchema(db) {
  db.exec(`
    -- 1. Players Table
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      youtube_channel_id TEXT NOT NULL UNIQUE,
      public_player_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_players_public_id ON players(public_player_id);
    CREATE INDEX IF NOT EXISTS idx_players_youtube_id ON players(youtube_channel_id);

    -- 2. Rarities Table
    CREATE TABLE IF NOT EXISTS rarities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    -- 3. Catalog Items Table
    CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('fish', 'mining', 'chest')),
      name TEXT NOT NULL,
      rarity_id TEXT NOT NULL REFERENCES rarities(id),
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      base_sale_value INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_category ON catalog_items(category, active);

    -- 4. Player Inventory Table
    CREATE TABLE IF NOT EXISTS player_inventory (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK(quantity >= 0),
      first_found_at INTEGER NOT NULL,
      last_found_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory(player_id);

    -- 5. Collection Events Ledger (Idempotent event store)
    CREATE TABLE IF NOT EXISTS collection_events (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id),
      item_id TEXT NOT NULL REFERENCES catalog_items(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('found', 'sold', 'adjusted', 'chest_drop')),
      quantity_delta INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('fishing', 'mining', 'chest', 'admin', 'sale')),
      reference_id TEXT,
      occurred_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_player ON collection_events(player_id, occurred_at DESC);

    -- 6. Sales Reservations Table (Two-Phase Commit Safety)
    CREATE TABLE IF NOT EXISTS sales_reservations (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id),
      item_id TEXT NOT NULL REFERENCES catalog_items(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      status TEXT NOT NULL CHECK(status IN ('reserved', 'committed', 'cancelled', 'expired')),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_player_item ON sales_reservations(player_id, item_id, status);

    -- 7. Achievements Definitions
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('all', 'fish', 'mining', 'chest', 'special')),
      badge_icon TEXT NOT NULL DEFAULT '',
      requirement_type TEXT NOT NULL,
      requirement_value INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- 8. Player Achievements State (Authoritative Backend State)
    CREATE TABLE IF NOT EXISTS player_achievements (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('unlocked', 'revoked')),
      unlocked_at INTEGER NOT NULL,
      revoked_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, achievement_id)
    );
  `);
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
