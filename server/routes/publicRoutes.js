import { PlayerService } from '../services/playerService.js';
import { InventoryService } from '../services/inventoryService.js';
import { AchievementService } from '../services/achievementService.js';
import { sseService } from '../services/sseService.js';
import { publicRateLimiter } from '../middleware/rateLimiter.js';
import { queryAll } from '../db/index.js';

export function registerPublicRoutes(router) {
  // 1. Public Player Profile & Overview Stats
  router.get('/api/public/players/:publicPlayerId', publicRateLimiter, async (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const player = await PlayerService.getPlayerByPublicId(publicPlayerId);

      if (!player) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: `No collection found for ID: ${publicPlayerId}`
        });
      }

      const stats = await PlayerService.getPlayerStats(player.id);
      const recentActivity = await PlayerService.getPlayerRecentActivity(player.id, 8);

      return res.status(200).json({
        player: {
          publicPlayerId: player.publicPlayerId,
          displayName: player.displayName,
          avatarUrl: player.avatarUrl,
          titleBadge: 'Collector',
          createdAt: player.createdAt,
          lastSeenAt: player.lastSeenAt
        },
        stats,
        recentActivity
      });
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_PLAYER_FAILED',
        message: err.message
      });
    }
  });

  // 2. Category Collection
  router.get('/api/public/players/:publicPlayerId/collection', publicRateLimiter, async (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const { category, rarity, status, sort } = req.query || {};

      const collection = await InventoryService.getCategoryCollection({
        publicPlayerId,
        category: category || 'all',
        rarityFilter: rarity || null,
        statusFilter: status || null,
        sortBy: sort || 'rarity'
      });

      if (!collection) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: `No collection found for ID: ${publicPlayerId}`
        });
      }

      return res.status(200).json(collection);
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_COLLECTION_FAILED',
        message: err.message
      });
    }
  });

  // 3. Public Player Achievements
  router.get('/api/public/players/:publicPlayerId/achievements', publicRateLimiter, async (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const player = await PlayerService.getPlayerByPublicId(publicPlayerId);

      if (!player) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: `No collection found for ID: ${publicPlayerId}`
        });
      }

      const achievementsData = await AchievementService.getPlayerAchievements(player.id);
      return res.status(200).json(achievementsData);
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_ACHIEVEMENTS_FAILED',
        message: err.message
      });
    }
  });

  // 4. Recent Collection Events for Reconnection / Serverless Sync
  router.get('/api/public/players/:publicPlayerId/events', publicRateLimiter, async (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const since = parseInt(req.query?.since || '0', 10);
      const player = await PlayerService.getPlayerByPublicId(publicPlayerId);

      if (!player) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: `Player ${publicPlayerId} not found`
        });
      }

      const rows = await queryAll(
        `SELECT 
           ce.id, ce.event_type, ce.quantity_delta, ce.source, ce.occurred_at,
           ci.id as item_id, ci.name as item_name, ci.category,
           r.name as rarity_name, r.display_color as rarity_color
         FROM collection_events ce
         JOIN catalog_items ci ON ce.item_id = ci.id
         JOIN rarities r ON ci.rarity_id = r.id
         WHERE ce.player_id = ? AND ce.received_at > ?
         ORDER BY ce.received_at ASC
         LIMIT 50`,
        [player.id, since]
      );

      return res.status(200).json({
        publicPlayerId,
        events: rows.map((r) => ({
          id: r.id,
          eventType: r.event_type,
          delta: r.quantity_delta,
          itemId: r.item_id,
          itemName: r.item_name,
          category: r.category,
          rarity: r.rarity_name,
          rarityColor: r.rarity_color,
          occurredAt: r.occurred_at
        }))
      });
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_EVENTS_FAILED',
        message: err.message
      });
    }
  });

  // 5. Real-time Server-Sent Events (SSE)
  router.get('/api/public/players/:publicPlayerId/stream', async (req, res) => {
    const { publicPlayerId } = req.params;
    const player = await PlayerService.getPlayerByPublicId(publicPlayerId);

    if (!player) {
      return res.status(404).json({
        error: 'PLAYER_NOT_FOUND',
        message: `Player ${publicPlayerId} not found`
      });
    }

    // Set SSE HTTP response headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });

    sseService.addClient(publicPlayerId, res);
  });

  // 6. Active Catalog & Rarities Metadata
  router.get('/api/public/catalog', publicRateLimiter, async (req, res) => {
    try {
      const rarities = await queryAll(
        'SELECT id, name, display_color, sort_order FROM rarities WHERE active = 1 ORDER BY sort_order ASC'
      );
      const items = await queryAll(
        `SELECT ci.id, ci.category, ci.name, ci.rarity_id, ci.description, ci.image_url, ci.sort_order, ci.base_sale_value
         FROM catalog_items ci
         WHERE ci.active = 1
         ORDER BY ci.sort_order ASC`
      );

      return res.status(200).json({
        rarities,
        itemsCount: items.length,
        items
      });
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_CATALOG_FAILED',
        message: err.message
      });
    }
  });

  // 7. Player Search (for Homepage lookup)
  router.get('/api/public/search', publicRateLimiter, async (req, res) => {
    try {
      const query = req.query?.query || req.query?.q || '';
      const results = await PlayerService.searchPlayers(query, 10);
      return res.status(200).json({
        query,
        count: results.length,
        results
      });
    } catch (err) {
      return res.status(500).json({
        error: 'SEARCH_FAILED',
        message: err.message
      });
    }
  });
}
