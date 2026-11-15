import { PlayerService } from '../services/playerService.js';
import { InventoryService } from '../services/inventoryService.js';
import { AchievementService } from '../services/achievementService.js';
import { verifyBotAuth } from '../middleware/auth.js';

export function registerBotRoutes(router) {
  // 1. Player Upsert
  router.post('/api/v1/bot/players/upsert', verifyBotAuth, (req, res) => {
    try {
      const { youtubeChannelId, displayName, avatarUrl } = req.body || {};
      if (!youtubeChannelId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'youtubeChannelId is required'
        });
      }

      const result = PlayerService.upsertPlayer({
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

  // 2. Collection Events (Find / Drop) - Idempotent
  router.post('/api/v1/bot/collection-events', verifyBotAuth, (req, res) => {
    try {
      const { eventId, youtubeChannelId, itemId, quantity, source, referenceId, occurredAt } = req.body || {};

      if (!eventId || !youtubeChannelId || !itemId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'eventId, youtubeChannelId, and itemId are required'
        });
      }

      const result = InventoryService.recordCollectionEvent({
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

  // 3. Two-Phase Sale: Phase 1 (Reserve)
  router.post('/api/v1/bot/sales/reserve', verifyBotAuth, (req, res) => {
    try {
      const { reservationId, youtubeChannelId, itemId, quantity } = req.body || {};

      if (!reservationId || !youtubeChannelId || !itemId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'reservationId, youtubeChannelId, and itemId are required'
        });
      }

      const result = InventoryService.reserveSale({
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

  // 4. Two-Phase Sale: Phase 2A (Commit)
  router.post('/api/v1/bot/sales/commit', verifyBotAuth, (req, res) => {
    try {
      const { reservationId } = req.body || {};

      if (!reservationId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'reservationId is required'
        });
      }

      const result = InventoryService.commitSale({ reservationId });
      return res.status(200).json(result);
    } catch (err) {
      const status = err.code === 'RESERVATION_EXPIRED' ? 410 : 500;
      return res.status(status).json({
        error: err.code || 'SALE_COMMIT_FAILED',
        message: err.message
      });
    }
  });

  // 5. Two-Phase Sale: Phase 2B (Cancel)
  router.post('/api/v1/bot/sales/cancel', verifyBotAuth, (req, res) => {
    try {
      const { reservationId, reason } = req.body || {};

      if (!reservationId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'reservationId is required'
        });
      }

      const result = InventoryService.cancelSale({ reservationId, reason });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({
        error: 'SALE_CANCEL_FAILED',
        message: err.message
      });
    }
  });

  // 6. Direct Achievement Sync
  router.post('/api/v1/bot/achievements/sync', verifyBotAuth, (req, res) => {
    try {
      const { youtubeChannelId, achievementId, action } = req.body || {};

      if (!youtubeChannelId || !achievementId) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'youtubeChannelId and achievementId are required'
        });
      }

      const result = AchievementService.syncDirect(youtubeChannelId, achievementId, action || 'unlock');
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
