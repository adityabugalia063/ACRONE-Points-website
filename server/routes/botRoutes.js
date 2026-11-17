import { PlayerService } from '../services/playerService.js';
import { InventoryService } from '../services/inventoryService.js';
import { AchievementService } from '../services/achievementService.js';
import { verifyBotAuth } from '../middleware/auth.js';
import { botRateLimiter } from '../middleware/rateLimiter.js';
import { queryOne, queryAll } from '../db/index.js';

export function registerBotRoutes(router) {
  // 1. Health Check (Open to hosting probes & authenticated bot checks)
  router.get('/api/v1/bot/health', botRateLimiter, async (req, res) => {
    try {
      // Test database connectivity
      const dbCheck = await queryOne('SELECT 1 as alive;');
      const isDbAlive = Boolean(dbCheck?.alive);

      // Fetch active catalogue counts
      const counts = await queryAll(
        `SELECT category, COUNT(*) as count 
         FROM catalog_items 
         WHERE active = 1 
         GROUP BY category;`
      );

      const catalogue = { fish: 0, mining: 0, chest: 0, total: 0 };
      for (const row of counts) {
        if (catalogue[row.category] !== undefined) {
          catalogue[row.category] = Number(row.count);
        }
        catalogue.total += Number(row.count);
      }

      return res.status(200).json({
        status: isDbAlive ? 'healthy' : 'degraded',
        database: isDbAlive ? 'connected' : 'disconnected',
        apiVersion: '2.0.0',
        timestamp: Date.now(),
        catalogue
      });
    } catch (err) {
      return res.status(500).json({
        status: 'unhealthy',
        database: 'error',
        message: err.message,
        timestamp: Date.now()
      });
    }
  });

  // 2. Player Upsert (Stable YouTube Channel ID mapping)
  router.post('/api/v1/bot/players/upsert', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { youtubeChannelId, displayName, avatarUrl } = req.body || {};
      if (!youtubeChannelId || typeof youtubeChannelId !== 'string') {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'youtubeChannelId is required'
        });
      }

      const result = await PlayerService.upsertPlayer({
        youtubeChannelId,
        displayName,
        avatarUrl
      });

      return res.status(200).json({
        success: true,
        player: result
      });
    } catch (err) {
      return res.status(500).json({
        error: 'PLAYER_UPSERT_FAILED',
        message: err.message
      });
    }
  });

  // 2b. Player Balance Synchronization (Authoritative Desktop Bot Ledger -> Website Public Mirror)
  router.post('/api/v1/bot/players/balance/sync', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { youtubeChannelId, balance, revision, eventId } = req.body || {};

      if (!youtubeChannelId || typeof youtubeChannelId !== 'string') {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'youtubeChannelId is required'
        });
      }

      if (balance === undefined || balance === null) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'balance is required'
        });
      }

      const result = await PlayerService.syncPlayerBalance({
        youtubeChannelId,
        balance,
        revision: revision || 0,
        eventId
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = (err.code === 'BAD_REQUEST' || err.code === 'INVALID_BALANCE' || err.code === 'INVALID_REVISION') ? 400 : 500;
      return res.status(status).json({
        error: err.code || 'BALANCE_SYNC_FAILED',
        message: err.message
      });
    }
  });

  // 3. Catalogue Ingestion / Read
  router.get('/api/v1/bot/catalog', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const category = req.query?.category || null;
      const items = await InventoryService.getCatalog(category);
      return res.status(200).json({
        success: true,
        count: items.length,
        items
      });
    } catch (err) {
      return res.status(500).json({
        error: 'FETCH_CATALOG_FAILED',
        message: err.message
      });
    }
  });

  // 4. Catalogue Synchronization (Non-destructive)
  router.post('/api/v1/bot/catalog/sync', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { items } = req.body || {};
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'items array is required'
        });
      }

      const result = await InventoryService.syncCatalog(items);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({
        error: 'CATALOG_SYNC_FAILED',
        message: err.message
      });
    }
  });

  // 5. Player Inventory Snapshot (Bot recovery and initial sync)
  router.get('/api/v1/bot/players/snapshot', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { youtubeChannelId, publicPlayerId } = req.query || {};
      if (!youtubeChannelId && !publicPlayerId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'Either youtubeChannelId or publicPlayerId query parameter is required'
        });
      }

      const snapshot = await PlayerService.getPlayerSnapshot({
        youtubeChannelId,
        publicPlayerId
      });

      if (!snapshot) {
        return res.status(404).json({
          error: 'PLAYER_NOT_FOUND',
          message: 'Player could not be found'
        });
      }

      return res.status(200).json({
        success: true,
        ...snapshot
      });
    } catch (err) {
      return res.status(500).json({
        error: 'SNAPSHOT_FAILED',
        message: err.message
      });
    }
  });

  // 6. Collection Events (Find / Drop) - Idempotent
  router.post('/api/v1/bot/collection-events', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { eventId, youtubeChannelId, itemId, quantity, source, referenceId, occurredAt } = req.body || {};

      if (!eventId || !youtubeChannelId || !itemId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'eventId, youtubeChannelId, and itemId are required'
        });
      }

      const result = await InventoryService.recordCollectionEvent({
        eventId,
        youtubeChannelId,
        itemId,
        quantity: parseInt(quantity || 1, 10),
        source: source || 'fishing',
        referenceId,
        occurredAt
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.message.includes('does not exist') ? 404 : 500;
      return res.status(status).json({
        error: 'COLLECTION_EVENT_FAILED',
        message: err.message
      });
    }
  });

  // 7. Two-Phase Sale: Phase 1 (Reserve)
  router.post('/api/v1/bot/sales/reserve', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { reservationId, youtubeChannelId, itemId, quantity } = req.body || {};

      if (!reservationId || !youtubeChannelId || !itemId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'reservationId, youtubeChannelId, and itemId are required'
        });
      }

      const result = await InventoryService.reserveSale({
        reservationId,
        youtubeChannelId,
        itemId,
        quantity: parseInt(quantity || 1, 10)
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.code === 'INSUFFICIENT_QUANTITY' ? 400 : 500;
      return res.status(status).json({
        error: err.code || 'SALE_RESERVE_FAILED',
        message: err.message,
        available: err.available,
        owned: err.owned
      });
    }
  });

  // 8. Two-Phase Sale: Phase 2A (Commit)
  router.post('/api/v1/bot/sales/commit', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { reservationId } = req.body || {};

      if (!reservationId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'reservationId is required'
        });
      }

      const result = await InventoryService.commitSale({ reservationId });
      return res.status(200).json(result);
    } catch (err) {
      const status = err.code === 'RESERVATION_EXPIRED' ? 410 : 500;
      return res.status(status).json({
        error: err.code || 'SALE_COMMIT_FAILED',
        message: err.message
      });
    }
  });

  // 9. Two-Phase Sale: Phase 2B (Cancel)
  router.post('/api/v1/bot/sales/cancel', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { reservationId, reason } = req.body || {};

      if (!reservationId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'reservationId is required'
        });
      }

      const result = await InventoryService.cancelSale({ reservationId, reason });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({
        error: 'SALE_CANCEL_FAILED',
        message: err.message
      });
    }
  });

  // 10. Direct Achievement Sync
  router.post('/api/v1/bot/achievements/sync', botRateLimiter, verifyBotAuth, async (req, res) => {
    try {
      const { youtubeChannelId, achievementId, action } = req.body || {};

      if (!youtubeChannelId || !achievementId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'youtubeChannelId and achievementId are required'
        });
      }

      const result = await AchievementService.syncDirect(youtubeChannelId, achievementId, action || 'unlock');
      return res.status(200).json({
        success: true,
        ...result
      });
    } catch (err) {
      return res.status(500).json({
        error: 'ACHIEVEMENT_SYNC_FAILED',
        message: err.message
      });
    }
  });
}
