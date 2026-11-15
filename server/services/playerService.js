import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { config } from '../config.js';

export class PlayerService {
  /**
   * Resolves or creates a player by stable YouTube Channel ID.
   * Updates display name and avatar on every call.
   */
  static upsertPlayer({ youtubeChannelId, displayName, avatarUrl }) {
    if (!youtubeChannelId || typeof youtubeChannelId !== 'string') {
      throw new Error('youtubeChannelId is required');
    }
    const cleanName = (displayName || 'Collector').trim();
    const cleanAvatar = avatarUrl || '';
    const now = Date.now();

    const db = getDb();

    // Check if player already exists
    const stmtFind = db.prepare('SELECT * FROM players WHERE youtube_channel_id = ?');
    const existing = stmtFind.get(youtubeChannelId);

    if (existing) {
      const stmtUpdate = db.prepare(`
        UPDATE players 
        SET display_name = ?, avatar_url = ?, updated_at = ?, last_seen_at = ?
        WHERE id = ?
      `);
      stmtUpdate.run(cleanName, cleanAvatar, now, now, existing.id);

      return {
        id: existing.id,
        publicPlayerId: existing.public_player_id,
        displayName: cleanName,
        avatarUrl: cleanAvatar,
        collectionUrl: `${config.siteBaseUrl}/u/${existing.public_player_id}`,
        isNewPlayer: false
      };
    }

    // Create new player with stable opaque public ID
    const newId = crypto.randomUUID();
    const publicPlayerId = 'usr_' + crypto.randomBytes(6).toString('hex');

    const stmtInsert = db.prepare(`
      INSERT INTO players (id, youtube_channel_id, public_player_id, display_name, avatar_url, created_at, updated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmtInsert.run(newId, youtubeChannelId, publicPlayerId, cleanName, cleanAvatar, now, now, now);

    return {
      id: newId,
      publicPlayerId,
      displayName: cleanName,
      avatarUrl: cleanAvatar,
      collectionUrl: `${config.siteBaseUrl}/u/${publicPlayerId}`,
      isNewPlayer: true
    };
  }

  static getPlayerByPublicId(publicPlayerId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT id, public_player_id, display_name, avatar_url, created_at, updated_at, last_seen_at
      FROM players 
      WHERE public_player_id = ?
    `);
    const player = stmt.get(publicPlayerId);
    if (!player) return null;

    return {
      id: player.id,
      publicPlayerId: player.public_player_id,
      displayName: player.display_name,
      avatarUrl: player.avatar_url,
      createdAt: player.created_at,
      updatedAt: player.updated_at,
      lastSeenAt: player.last_seen_at
    };
  }

  static getPlayerByYoutubeId(youtubeChannelId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM players WHERE youtube_channel_id = ?');
    return stmt.get(youtubeChannelId) || null;
  }

  static getPlayerStats(playerId) {
    const db = getDb();

    // 1. Total quantity of items currently owned
    const stmtTotal = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total_quantity
      FROM player_inventory
      WHERE player_id = ? AND quantity > 0
    `);
    const { total_quantity: totalQuantity } = stmtTotal.get(playerId) || { total_quantity: 0 };

    // 2. Total unique active item types currently owned
    const stmtUnique = db.prepare(`
      SELECT COUNT(DISTINCT pi.item_id) as unique_types
      FROM player_inventory pi
      JOIN catalog_items ci ON pi.item_id = ci.id
      WHERE pi.player_id = ? AND pi.quantity > 0 AND ci.active = 1
    `);
    const { unique_types: uniqueItemTypes } = stmtUnique.get(playerId) || { unique_types: 0 };

    // 3. Category breakdown
    const categories = ['fish', 'mining', 'chest'];
    const categoryStats = {};
    let totalActiveAcrossAll = 0;
    let totalDiscoveredAcrossAll = 0;

    for (const cat of categories) {
      // Discovered count
      const stmtCatDisc = db.prepare(`
        SELECT COUNT(DISTINCT pi.item_id) as discovered
        FROM player_inventory pi
        JOIN catalog_items ci ON pi.item_id = ci.id
        WHERE pi.player_id = ? AND ci.category = ? AND pi.quantity > 0 AND ci.active = 1
      `);
      const { discovered } = stmtCatDisc.get(playerId, cat) || { discovered: 0 };

      // Total active catalogue items
      const stmtCatTotal = db.prepare(`
        SELECT COUNT(*) as total
        FROM catalog_items
        WHERE category = ? AND active = 1
      `);
      const { total } = stmtCatTotal.get(cat) || { total: 0 };

      const pct = total > 0 ? Math.round((discovered / total) * 1000) / 10 : 0;

      categoryStats[cat] = {
        discovered,
        total,
        completionPercentage: pct
      };

      totalActiveAcrossAll += total;
      totalDiscoveredAcrossAll += discovered;
    }

    const overallPct = totalActiveAcrossAll > 0 
      ? Math.round((totalDiscoveredAcrossAll / totalActiveAcrossAll) * 1000) / 10 
      : 0;

    return {
      totalQuantity,
      uniqueItemTypes,
      overallCompletionPercentage: overallPct,
      categories: categoryStats
    };
  }

  static getPlayerRecentActivity(playerId, limit = 8) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        ce.id, ce.event_type, ce.quantity_delta, ce.source, ce.occurred_at,
        ci.id as item_id, ci.name as item_name, ci.category, ci.image_url,
        r.id as rarity_id, r.name as rarity_name, r.display_color as rarity_color
      FROM collection_events ce
      JOIN catalog_items ci ON ce.item_id = ci.id
      JOIN rarities r ON ci.rarity_id = r.id
      WHERE ce.player_id = ?
      ORDER BY ce.occurred_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(playerId, limit);
    return rows.map(r => ({
      eventId: r.id,
      eventType: r.event_type,
      quantityDelta: r.quantity_delta,
      source: r.source,
      occurredAt: r.occurred_at,
      item: {
        id: r.item_id,
        name: r.item_name,
        category: r.category,
        imageUrl: r.image_url,
        rarity: {
          id: r.rarity_id,
          name: r.rarity_name,
          color: r.rarity_color
        }
      }
    }));
  }

  static searchPlayers(query, limit = 10) {
    if (!query || typeof query !== 'string') return [];
    const db = getDb();
    const clean = `%${query.trim()}%`;
    const stmt = db.prepare(`
      SELECT public_player_id, display_name, avatar_url, updated_at
      FROM players
      WHERE display_name LIKE ? OR public_player_id LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    return stmt.all(clean, clean, limit).map(p => ({
      publicPlayerId: p.public_player_id,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      profileUrl: `/u/${p.public_player_id}`
    }));
  }
}
