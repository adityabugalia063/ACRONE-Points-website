import { getDb } from '../db/index.js';
import { sseService } from './sseService.js';

export class AchievementService {
  /**
   * Evaluates all data-driven achievement criteria against current owned inventory.
   * Awards newly qualified badges and automatically revokes badges if an item sale
   * drops the player below the requirement threshold.
   */
  static evaluatePlayerAchievements(playerId) {
    const db = getDb();
    const now = Date.now();

    // 1. Get all active achievement definitions
    const achievements = db.prepare('SELECT * FROM achievements WHERE active = 1 ORDER BY sort_order ASC').all();

    // 2. Get current player achievement states
    const existingStates = new Map();
    const currentRows = db.prepare('SELECT * FROM player_achievements WHERE player_id = ?').all(playerId);
    for (const row of currentRows) {
      existingStates.set(row.achievement_id, row);
    }

    // 3. Precalculate metrics for player
    // Unique counts
    const uniqueByCat = { all: 0, fish: 0, mining: 0, chest: 0 };
    const totalByCat = { all: 0, fish: 0, mining: 0, chest: 0 };

    const invRows = db.prepare(`
      SELECT pi.item_id, pi.quantity, ci.category 
      FROM player_inventory pi
      JOIN catalog_items ci ON pi.item_id = ci.id
      WHERE pi.player_id = ? AND pi.quantity > 0 AND ci.active = 1
    `).all(playerId);

    for (const inv of invRows) {
      uniqueByCat.all += 1;
      totalByCat.all += inv.quantity;
      if (uniqueByCat[inv.category] !== undefined) {
        uniqueByCat[inv.category] += 1;
        totalByCat[inv.category] += inv.quantity;
      }
    }

    const awarded = [];
    const revoked = [];

    // Statements
    const stmtUnlock = db.prepare(`
      INSERT INTO player_achievements (player_id, achievement_id, status, unlocked_at, revoked_at, updated_at)
      VALUES (?, ?, 'unlocked', ?, NULL, ?)
      ON CONFLICT(player_id, achievement_id) DO UPDATE SET
        status = 'unlocked',
        revoked_at = NULL,
        updated_at = excluded.updated_at
    `);

    const stmtRevoke = db.prepare(`
      UPDATE player_achievements
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE player_id = ? AND achievement_id = ? AND status = 'unlocked'
    `);

    for (const ach of achievements) {
      let meetsRequirement = false;

      if (ach.requirement_type === 'unique_count') {
        const count = uniqueByCat[ach.category] || 0;
        meetsRequirement = (count >= ach.requirement_value);
      } else if (ach.requirement_type === 'total_count') {
        const count = totalByCat[ach.category] || 0;
        meetsRequirement = (count >= ach.requirement_value);
      } else if (ach.requirement_type === 'specific_item') {
        const itemRow = db.prepare(`
          SELECT quantity FROM player_inventory 
          WHERE player_id = ? AND item_id = ? AND quantity > 0
        `).get(playerId, ach.code);
        meetsRequirement = Boolean(itemRow && itemRow.quantity > 0);
      }

      const currentState = existingStates.get(ach.id);

      if (meetsRequirement) {
        if (!currentState || currentState.status !== 'unlocked') {
          stmtUnlock.run(playerId, ach.id, now, now);
          awarded.push({
            id: ach.id,
            name: ach.name,
            description: ach.description,
            badgeIcon: ach.badge_icon
          });
        }
      } else {
        // Requirement is lost (e.g. final copy of item was sold)
        if (currentState && currentState.status === 'unlocked') {
          stmtRevoke.run(now, now, playerId, ach.id);
          revoked.push({
            id: ach.id,
            name: ach.name,
            description: ach.description,
            badgeIcon: ach.badge_icon
          });
        }
      }
    }

    return { awarded, revoked };
  }

  static getPlayerAchievements(playerId) {
    const db = getDb();
    const stmt = db.prepare(`
      SELECT 
        a.id, a.code, a.name, a.description, a.category, a.badge_icon,
        a.requirement_type, a.requirement_value, a.sort_order,
        pa.status, pa.unlocked_at, pa.revoked_at
      FROM achievements a
      LEFT JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.player_id = ?
      WHERE a.active = 1
      ORDER BY a.sort_order ASC
    `);

    const rows = stmt.all(playerId);
    let unlockedCount = 0;

    const list = rows.map(r => {
      const isUnlocked = r.status === 'unlocked';
      if (isUnlocked) unlockedCount++;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        category: r.category,
        badgeIcon: r.badge_icon,
        requirementType: r.requirement_type,
        requirementValue: r.requirement_value,
        isUnlocked,
        unlockedAt: r.unlocked_at,
        revokedAt: r.revoked_at
      };
    });

    return {
      unlockedCount,
      totalCount: rows.length,
      achievements: list
    };
  }

  static syncDirect(youtubeChannelId, achievementId, action = 'unlock') {
    const db = getDb();
    const player = db.prepare('SELECT id, public_player_id FROM players WHERE youtube_channel_id = ?').get(youtubeChannelId);
    if (!player) throw new Error('Player not found for YouTube ID');

    const ach = db.prepare('SELECT id, name FROM achievements WHERE id = ?').get(achievementId);
    if (!ach) throw new Error('Achievement ID not found');

    const now = Date.now();
    if (action === 'unlock') {
      db.prepare(`
        INSERT INTO player_achievements (player_id, achievement_id, status, unlocked_at, revoked_at, updated_at)
        VALUES (?, ?, 'unlocked', ?, NULL, ?)
        ON CONFLICT(player_id, achievement_id) DO UPDATE SET
          status = 'unlocked', revoked_at = NULL, updated_at = excluded.updated_at
      `).run(player.id, achievementId, now, now);

      sseService.broadcastToPlayer(player.public_player_id, 'achievement_unlocked', {
        achievementId,
        name: ach.name,
        unlockedAt: now
      });
      return { status: 'unlocked' };
    } else {
      db.prepare(`
        UPDATE player_achievements 
        SET status = 'revoked', revoked_at = ?, updated_at = ?
        WHERE player_id = ? AND achievement_id = ?
      `).run(now, now, player.id, achievementId);

      sseService.broadcastToPlayer(player.public_player_id, 'achievement_revoked', {
        achievementId,
        name: ach.name,
        revokedAt: now
      });
      return { status: 'revoked' };
    }
  }
}
