import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/index.js';
import { config } from '../config.js';

export class PlayerService {
  /**
   * Resolves or creates a player by stable YouTube Channel ID.
   * Updates display name and avatar on every call.
   * Preserves existing publicPlayerId and never creates duplicates.
   */
  static async upsertPlayer({ youtubeChannelId, displayName, avatarUrl }) {
    if (!youtubeChannelId || typeof youtubeChannelId !== 'string') {
      throw new Error('youtubeChannelId is required');
    }
    const cleanName = (displayName || 'Collector').trim();
    const cleanAvatar = avatarUrl || '';
    const now = Date.now();

    // Check if player already exists
    const existing = await queryOne(
      'SELECT id, public_player_id, display_name, avatar_url, created_at FROM players WHERE youtube_channel_id = ?',
      [youtubeChannelId]
    );

    if (existing) {
      await execute(
        `UPDATE players 
         SET display_name = ?, avatar_url = ?, updated_at = ?, last_seen_at = ?
         WHERE id = ?`,
        [cleanName, cleanAvatar, now, now, existing.id]
      );

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

    await execute(
      `INSERT INTO players (id, youtube_channel_id, public_player_id, display_name, avatar_url, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, youtubeChannelId, publicPlayerId, cleanName, cleanAvatar, now, now, now]
    );

    return {
      id: newId,
      publicPlayerId,
      displayName: cleanName,
      avatarUrl: cleanAvatar,
      collectionUrl: `${config.siteBaseUrl}/u/${publicPlayerId}`,
      isNewPlayer: true
    };
  }

  static async getPlayerByPublicId(publicPlayerId) {
    const player = await queryOne(
      `SELECT id, youtube_channel_id, public_player_id, display_name, avatar_url, created_at, updated_at, last_seen_at
       FROM players 
       WHERE public_player_id = ?`,
      [publicPlayerId]
    );
    if (!player) return null;

    return {
      id: player.id,
      youtubeChannelId: player.youtube_channel_id,
      publicPlayerId: player.public_player_id,
      displayName: player.display_name,
      avatarUrl: player.avatar_url,
      createdAt: player.created_at,
      updatedAt: player.updated_at,
      lastSeenAt: player.last_seen_at
    };
  }

  static async getPlayerByYoutubeId(youtubeChannelId) {
    return queryOne('SELECT * FROM players WHERE youtube_channel_id = ?', [youtubeChannelId]);
  }

  static async getPlayerStats(playerId) {
    // 1. Total quantity of items currently owned
    const totalRow = await queryOne(
      `SELECT COALESCE(SUM(quantity), 0) as total_quantity
       FROM player_inventory
       WHERE player_id = ? AND quantity > 0`,
      [playerId]
    );
    const totalQuantity = Number(totalRow?.total_quantity || 0);

    // 2. Total unique active item types currently owned
    const uniqueRow = await queryOne(
      `SELECT COUNT(DISTINCT pi.item_id) as unique_types
       FROM player_inventory pi
       JOIN catalog_items ci ON pi.item_id = ci.id
       WHERE pi.player_id = ? AND pi.quantity > 0 AND ci.active = 1`,
      [playerId]
    );
    const uniqueItemTypes = Number(uniqueRow?.unique_types || 0);

    // 3. Category breakdown
    const categories = ['fish', 'mining', 'chest'];
    const categoryStats = {};
    let totalActiveAcrossAll = 0;
    let totalDiscoveredAcrossAll = 0;

    for (const cat of categories) {
      const discRow = await queryOne(
        `SELECT COUNT(DISTINCT pi.item_id) as discovered
         FROM player_inventory pi
         JOIN catalog_items ci ON pi.item_id = ci.id
         WHERE pi.player_id = ? AND ci.category = ? AND pi.quantity > 0 AND ci.active = 1`,
        [playerId, cat]
      );
      const discovered = Number(discRow?.discovered || 0);

      const totalRowCat = await queryOne(
        `SELECT COUNT(*) as total
         FROM catalog_items
         WHERE category = ? AND active = 1`,
        [cat]
      );
      const total = Number(totalRowCat?.total || 0);

      const pct = total > 0 ? Math.round((discovered / total) * 1000) / 10 : 0;

      categoryStats[cat] = {
        discovered,
        total,
        completionPercentage: pct
      };

      totalActiveAcrossAll += total;
      totalDiscoveredAcrossAll += discovered;
    }

    const overallPct =
      totalActiveAcrossAll > 0
        ? Math.round((totalDiscoveredAcrossAll / totalActiveAcrossAll) * 1000) / 10
        : 0;

    return {
      totalQuantity,
      uniqueItemTypes,
      overallCompletionPercentage: overallPct,
      categories: categoryStats
    };
  }

  static async getPlayerRecentActivity(playerId, limit = 8) {
    const rows = await queryAll(
      `SELECT 
         ce.id, ce.event_type, ce.quantity_delta, ce.source, ce.occurred_at,
         ci.id as item_id, ci.name as item_name, ci.category, ci.image_url,
         r.id as rarity_id, r.name as rarity_name, r.display_color as rarity_color
       FROM collection_events ce
       JOIN catalog_items ci ON ce.item_id = ci.id
       JOIN rarities r ON ci.rarity_id = r.id
       WHERE ce.player_id = ?
       ORDER BY ce.occurred_at DESC
       LIMIT ?`,
      [playerId, limit]
    );

    return rows.map((r) => ({
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

  static async searchPlayers(query, limit = 10) {
    if (!query || typeof query !== 'string') return [];
    const clean = `%${query.trim()}%`;
    const rows = await queryAll(
      `SELECT public_player_id, display_name, avatar_url, updated_at
       FROM players
       WHERE display_name LIKE ? OR public_player_id LIKE ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [clean, clean, limit]
    );

    return rows.map((p) => ({
      publicPlayerId: p.public_player_id,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      profileUrl: `/u/${p.public_player_id}`
    }));
  }

  /**
   * Complete inventory snapshot for bot recovery and initial sync.
   */
  static async getPlayerSnapshot({ youtubeChannelId, publicPlayerId }) {
    let player = null;
    if (youtubeChannelId) {
      player = await this.getPlayerByYoutubeId(youtubeChannelId);
    } else if (publicPlayerId) {
      player = await this.getPlayerByPublicId(publicPlayerId);
    }

    if (!player) return null;

    const stats = await this.getPlayerStats(player.id);

    const inventoryRows = await queryAll(
      `SELECT 
         pi.item_id, pi.quantity, pi.first_found_at, pi.last_found_at,
         ci.name, ci.category, ci.base_sale_value,
         r.id as rarity_id, r.name as rarity_name
       FROM player_inventory pi
       JOIN catalog_items ci ON pi.item_id = ci.id
       JOIN rarities r ON ci.rarity_id = r.id
       WHERE pi.player_id = ? AND pi.quantity > 0
       ORDER BY ci.sort_order ASC`,
      [player.id]
    );

    const inventory = inventoryRows.map((r) => ({
      itemId: r.item_id,
      name: r.name,
      category: r.category,
      rarity: r.rarity_name,
      quantity: r.quantity,
      baseSaleValue: r.base_sale_value,
      firstFoundAt: r.first_found_at,
      lastFoundAt: r.last_found_at
    }));

    const achRows = await queryAll(
      `SELECT 
         a.id, a.code, a.name, a.category, pa.status, pa.unlocked_at
       FROM achievements a
       JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.player_id = ?
       WHERE pa.status = 'unlocked'
       ORDER BY a.sort_order ASC`,
      [player.id]
    );

    const achievements = achRows.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      category: a.category,
      status: a.status,
      unlockedAt: a.unlocked_at
    }));

    return {
      player: {
        publicPlayerId: player.public_player_id,
        displayName: player.display_name,
        avatarUrl: player.avatar_url,
        createdAt: player.created_at,
        lastSeenAt: player.last_seen_at
      },
      stats,
      inventory,
      achievements
    };
  }
}
