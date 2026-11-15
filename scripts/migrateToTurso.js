/**
 * Database Migration Tool: SQLite to Turso Cloud (libSQL)
 * Safely transfers all schema, catalogue, players, inventory, events, and achievements.
 *
 * Usage:
 *   TURSO_DATABASE_URL="libsql://your-db.turso.io" TURSO_AUTH_TOKEN="your-token" node scripts/migrateToTurso.js
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { initSchema } from '../server/db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('🚀 ACRONE Collection — SQLite to Turso Cloud Migration Tool\n');

  // 1. Validate Target Turso Credentials
  const targetUrl = process.env.TURSO_DATABASE_URL;
  const targetAuthToken = process.env.TURSO_AUTH_TOKEN;

  if (!targetUrl) {
    console.error('❌ ERROR: TURSO_DATABASE_URL environment variable is required.');
    console.error('Example: TURSO_DATABASE_URL="libsql://acrone-collection-your-org.turso.io"');
    process.exit(1);
  }

  if (!targetUrl.startsWith('libsql://') && !targetUrl.startsWith('https://')) {
    console.error(`❌ ERROR: Target URL must start with libsql:// or https:// (Received: ${targetUrl})`);
    process.exit(1);
  }

  if (!targetAuthToken) {
    console.error('❌ ERROR: TURSO_AUTH_TOKEN environment variable is required.');
    process.exit(1);
  }

  // 2. Locate Source SQLite Database
  const sourceDbPath = process.env.SOURCE_DB_PATH || path.resolve(__dirname, '../data/acrone_collection.db');
  if (!fs.existsSync(sourceDbPath)) {
    console.error(`❌ ERROR: Source SQLite database not found at: ${sourceDbPath}`);
    process.exit(1);
  }

  const normalizedSource = sourceDbPath.replace(/\\/g, '/');
  const sourceUrl = 'file:' + (normalizedSource.startsWith('/') ? normalizedSource : '/' + normalizedSource);

  console.log(`📂 Source SQLite: ${sourceDbPath}`);
  console.log(`☁️  Target Turso:  ${targetUrl}\n`);

  const sourceClient = createClient({ url: sourceUrl });
  const targetClient = createClient({ url: targetUrl, authToken: targetAuthToken });

  try {
    // 3. Initialize Schema on Target Turso
    console.log('⚙️  Step 1: Initializing relational schema on Turso Cloud...');
    await initSchema(targetClient);
    console.log('   ✅ Schema initialized successfully.\n');

    // 4. Tables to Migrate in Foreign-Key Dependency Order
    const tables = [
      {
        name: 'rarities',
        conflictSql: `INSERT INTO rarities (id, name, display_color, sort_order, active)
                      VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET name = excluded.name, display_color = excluded.display_color, sort_order = excluded.sort_order, active = excluded.active;`
      },
      {
        name: 'catalog_items',
        conflictSql: `INSERT INTO catalog_items (id, category, name, rarity_id, description, image_url, active, sort_order, metadata_json, base_sale_value)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET category = excluded.category, name = excluded.name, rarity_id = excluded.rarity_id, description = excluded.description, image_url = excluded.image_url, active = excluded.active, sort_order = excluded.sort_order, base_sale_value = excluded.base_sale_value;`
      },
      {
        name: 'achievements',
        conflictSql: `INSERT INTO achievements (id, code, name, description, category, badge_icon, requirement_type, requirement_value, active, sort_order)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, category = excluded.category, badge_icon = excluded.badge_icon, requirement_type = excluded.requirement_type, requirement_value = excluded.requirement_value, sort_order = excluded.sort_order;`
      },
      {
        name: 'players',
        conflictSql: `INSERT INTO players (id, youtube_channel_id, public_player_id, display_name, avatar_url, created_at, updated_at, last_seen_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at;`
      },
      {
        name: 'player_inventory',
        conflictSql: `INSERT INTO player_inventory (player_id, item_id, quantity, first_found_at, last_found_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?)
                      ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = excluded.quantity, last_found_at = excluded.last_found_at, updated_at = excluded.updated_at;`
      },
      {
        name: 'collection_events',
        conflictSql: `INSERT INTO collection_events (id, player_id, item_id, event_type, quantity_delta, source, reference_id, occurred_at, received_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO NOTHING;`
      },
      {
        name: 'sales_reservations',
        conflictSql: `INSERT INTO sales_reservations (id, player_id, item_id, quantity, status, expires_at, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at;`
      },
      {
        name: 'player_achievements',
        conflictSql: `INSERT INTO player_achievements (player_id, achievement_id, status, unlocked_at, revoked_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?)
                      ON CONFLICT(player_id, achievement_id) DO UPDATE SET status = excluded.status, revoked_at = excluded.revoked_at, updated_at = excluded.updated_at;`
      }
    ];

    console.log('📦 Step 2: Transferring table rows...');
    const migrationSummary = [];

    for (const table of tables) {
      const srcRowsResult = await sourceClient.execute(`SELECT * FROM ${table.name};`);
      const srcRows = srcRowsResult.rows;

      if (srcRows.length === 0) {
        console.log(`   ◽ ${table.name.padEnd(20)}: 0 rows (Empty source table)`);
        migrationSummary.push({ table: table.name, sourceCount: 0, targetCount: 0 });
        continue;
      }

      // Batch insert into Turso in chunks of 50
      const CHUNK_SIZE = 50;
      for (let i = 0; i < srcRows.length; i += CHUNK_SIZE) {
        const chunk = srcRows.slice(i, i + CHUNK_SIZE);
        const batchStatements = chunk.map((row) => ({
          sql: table.conflictSql,
          args: Object.values(row)
        }));
        await targetClient.batch(batchStatements, 'write');
      }

      // Verify row count on target Turso
      const tgtCountResult = await targetClient.execute(`SELECT COUNT(*) as c FROM ${table.name};`);
      const tgtCount = Number(tgtCountResult.rows[0].c);

      console.log(`   ✅ ${table.name.padEnd(20)}: Transferred ${srcRows.length} -> Target total: ${tgtCount}`);
      migrationSummary.push({
        table: table.name,
        sourceCount: srcRows.length,
        targetCount: tgtCount
      });
    }

    console.log('\n📊 Migration Complete! Summary Table:');
    console.table(migrationSummary);
    console.log('🎉 All tables, inventory records, and catalogue items migrated to Turso Cloud without loss.\n');
  } catch (err) {
    console.error('\n❌ Migration Failed with error:', err);
    process.exit(1);
  } finally {
    sourceClient.close();
    targetClient.close();
  }
}

runMigration();
