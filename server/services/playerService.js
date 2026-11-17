import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/index.js';
import { config } from '../config.js';
import { sseService } from './sseService.js';
import { playerCache, searchCache, profileResponseCache } from './cacheService.js';

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

      playerCache.clear();
      profileResponseCache.clear();
      searchCache.clear();

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

    playerCache.clear();
    profileResponseCache.clear();
    searchCache.clear();

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
    if (!publicPlayerId || typeof publicPlayerId !== 'string') return null;
    const clean = publicPlayerId.trim();
    const cacheKey = clean.toLowerCase();
    const cached = playerCache.get(cacheKey);
    if (cached) return cached;

    // Use fast indexed query path
    const isPublicId = clean.toLowerCase().startsWith('usr_');
    const player = await queryOne(
      isPublicId
        ? `SELECT id, youtube_channel_id, public_player_id, display_name, avatar_url, balance, balance_revision, balance_updated_at, created_at, updated_at, last_seen_at
           FROM players 
           WHERE public_player_id = ?`
        : `SELECT id, youtube_channel_id, public_player_id, display_name, avatar_url, balance, balance_revision, balance_updated_at, created_at, updated_at, last_seen_at
           FROM players 
           WHERE display_name = ? COLLATE NOCASE OR public_player_id = ?`,
      isPublicId ? [clean] : [clean, clean]
    );
    if (!player) return null;

    const res = {
      id: player.id,
      youtubeChannelId: player.youtube_channel_id,
      publicPlayerId: player.public_player_id,
      displayName: player.display_name,
      avatarUrl: player.avatar_url,
      balance: Number(player.balance || 0),
      balanceRevision: Number(player.balance_revision || 0),
      balanceUpdatedAt: player.balance_updated_at,
      createdAt: player.created_at,
      updatedAt: player.updated_at,
      lastSeenAt: player.last_seen_at
    };

    playerCache.set(res.publicPlayerId.toLowerCase(), res);
    playerCache.set(res.displayName.toLowerCase(), res);
    return res;
  }

  static async getPlayerByYoutubeId(youtubeChannelId) {
    return queryOne('SELECT * FROM players WHERE youtube_channel_id = ?', [youtubeChannelId]);
  }

  static async getPlayerStats(playerId) {
    // Single-query category aggregation for sub-50ms execution
    const rows = await queryAll(
      `SELECT 
         ci.category,
         COUNT(DISTINCT ci.id) as total_in_category,
         COUNT(DISTINCT CASE WHEN pi.quantity > 0 THEN pi.item_id END) as discovered_in_category,
         COALESCE(SUM(CASE WHEN pi.quantity > 0 THEN pi.quantity ELSE 0 END), 0) as category_quantity
       FROM catalog_items ci
       LEFT JOIN player_inventory pi ON ci.id = pi.item_id AND pi.player_id = ?
       WHERE ci.active = 1
       GROUP BY ci.category`,
      [playerId]
    );

    const categories = ['fish', 'mining', 'chest'];
    const categoryStats = {};
    let totalActiveAcrossAll = 0;
    let totalDiscoveredAcrossAll = 0;
    let totalQuantity = 0;
    let uniqueItemTypes = 0;

    const rowMap = new Map();
    for (const r of rows) {
      rowMap.set(r.category, r);
    }

    for (const cat of categories) {
      const r = rowMap.get(cat) || {
        total_in_category: 0,
        discovered_in_category: 0,
        category_quantity: 0
      };
      const total = Number(r.total_in_category || 0);
      const discovered = Number(r.discovered_in_category || 0);
      const qty = Number(r.category_quantity || 0);

      totalActiveAcrossAll += total;
      totalDiscoveredAcrossAll += discovered;
      totalQuantity += qty;
      uniqueItemTypes += discovered;

      const pct = total > 0 ? Math.round((discovered / total) * 1000) / 10 : 0;

      categoryStats[cat] = {
        discovered,
        total,
        completionPercentage: pct
      };
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
    const term = query.trim().toLowerCase();
    const cacheKey = term + '_' + limit;
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    const clean = `%${term}%`;
    const rows = await queryAll(
      `SELECT public_player_id, display_name, avatar_url, updated_at
       FROM players
       WHERE display_name LIKE ? OR public_player_id LIKE ?
       ORDER BY updated_at DESC
       LIMIT ?`,
      [clean, clean, limit]
    );

    const mapped = rows.map((p) => ({
      publicPlayerId: p.public_player_id,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      profileUrl: `/u/${p.public_player_id}`
    }));

    searchCache.set(cacheKey, mapped);
    return mapped;
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
        balance: Number(player.balance || 0),
        balanceRevision: Number(player.balance_revision || 0),
        createdAt: player.created_at,
        lastSeenAt: player.last_seen_at
      },
      stats,
      inventory,
      achievements
    };
  }

  /**
   * Synchronizes player balance snapshot from local Streamer.bot points ledger.
   * Enforces monotonic revisions and broadcasts updates via SSE.
   */
  static async syncPlayerBalance({ youtubeChannelId, balance, revision, eventId }) {
    if (!youtubeChannelId || typeof youtubeChannelId !== 'string') {
      const err = new Error('youtubeChannelId is required');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const numBalance = Number(balance);
    if (!Number.isFinite(numBalance) || numBalance < 0 || !Number.isInteger(numBalance)) {
      const err = new Error('balance must be a non-negative integer');
      err.code = 'INVALID_BALANCE';
      throw err;
    }

    const numRevision = Number(revision ?? 0);
    if (!Number.isFinite(numRevision) || numRevision < 0 || !Number.isInteger(numRevision)) {
      const err = new Error('revision must be a non-negative integer');
      err.code = 'INVALID_REVISION';
      throw err;
    }

    const now = Date.now();

    // Look up or auto-register player
    let player = await queryOne(
      'SELECT id, public_player_id, balance, balance_revision FROM players WHERE youtube_channel_id = ?',
      [youtubeChannelId]
    );

    if (!player) {
      const upserted = await this.upsertPlayer({
        youtubeChannelId,
        displayName: 'Collector'
      });
      player = await queryOne(
        'SELECT id, public_player_id, balance, balance_revision FROM players WHERE id = ?',
        [upserted.id]
      );
    }

    const currentRevision = Number(player.balance_revision || 0);
    const currentBalance = Number(player.balance || 0);

    // Reject stale revisions: older balance revisions cannot overwrite newer balances
    if (numRevision < currentRevision) {
      return {
        success: true,
        stale: true,
        message: 'Stale revision ignored',
        balance: currentBalance,
        revision: currentRevision,
        publicPlayerId: player.public_player_id
      };
    }

    // Update player balance and revision
    await execute(
      `UPDATE players
       SET balance = ?, balance_revision = ?, balance_updated_at = ?, updated_at = ?
       WHERE id = ?`,
      [numBalance, numRevision, now, now, player.id]
    );

    playerCache.clear();
    profileResponseCache.clear();

    // Broadcast SSE update to public profile in real-time
    try {
      sseService.broadcastToPlayer(player.public_player_id, 'balance_updated', {
        balance: numBalance,
        revision: numRevision,
        updatedAt: now
      });
    } catch (_) {}

    return {
      success: true,
      balance: numBalance,
      revision: numRevision,
      publicPlayerId: player.public_player_id
    };
  }
}
