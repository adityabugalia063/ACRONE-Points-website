import { PlayerService } from '../services/playerService.js';
import { InventoryService } from '../services/inventoryService.js';
import { AchievementService } from '../services/achievementService.js';
import { sseService } from '../services/sseService.js';
import { getDb } from '../db/index.js';

export function registerPublicRoutes(router) {
  // 1. Public Player Profile & Overview Stats
  router.get('/api/public/players/:publicPlayerId', (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const player = PlayerService.getPlayerByPublicId(publicPlayerId);

      if (!player) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: `No collection found for ID: ${publicPlayerId}`
        });
      }

      const stats = PlayerService.getPlayerStats(player.id);
      const recentActivity = PlayerService.getPlayerRecentActivity(player.id, 8);

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
  router.get('/api/public/players/:publicPlayerId/collection', (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const { category, rarity, status, sort } = req.query;

      const collection = InventoryService.getCategoryCollection({
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
  router.get('/api/public/players/:publicPlayerId/achievements', (req, res) => {
    try {
      const { publicPlayerId } = req.params;
      const player = PlayerService.getPlayerByPublicId(publicPlayerId);

      if (!player) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: `No collection found for ID: ${publicPlayerId}`
        });
      }

      const achievementsData = AchievementService.getPlayerAchievements(player.id);
      return res.status(200).json(achievementsData);
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_ACHIEVEMENTS_FAILED',
        message: err.message
      });
    }
  });

  // 4. Real-time Server-Sent Events (SSE)
  router.get('/api/public/players/:publicPlayerId/stream', (req, res) => {
    const { publicPlayerId } = req.params;
    const player = PlayerService.getPlayerByPublicId(publicPlayerId);

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

  // 5. Active Catalog & Rarities Metadata
  router.get('/api/public/catalog', (req, res) => {
    try {
      const db = getDb();
      const rarities = db.prepare('SELECT id, name, display_color, sort_order FROM rarities WHERE active = 1 ORDER BY sort_order ASC').all();
      const items = db.prepare(`
        SELECT ci.id, ci.category, ci.name, ci.rarity_id, ci.description, ci.image_url, ci.sort_order
        FROM catalog_items ci
        WHERE ci.active = 1
        ORDER BY ci.sort_order ASC
      `).all();

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

  // 6. Player Search (for Homepage lookup)
  router.get('/api/public/search', (req, res) => {
    try {
      const query = req.query.query || req.query.q || '';
      const results = PlayerService.searchPlayers(query, 10);
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
