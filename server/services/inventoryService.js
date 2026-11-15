import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { PlayerService } from './playerService.js';
import { AchievementService } from './achievementService.js';
import { sseService } from './sseService.js';

export class InventoryService {
  /**
   * Records a found or dropped item idempotently.
   * Duplicate submissions with the same eventId return the cached response.
   */
  static recordCollectionEvent({
    eventId,
    youtubeChannelId,
    itemId,
    quantity = 1,
    source = 'fishing',
    referenceId = null,
    occurredAt = null
  }) {
    if (!eventId) throw new Error('eventId is required as an idempotency key');
    if (!youtubeChannelId) throw new Error('youtubeChannelId is required');
    if (!itemId) throw new Error('itemId is required');
    if (quantity <= 0) throw new Error('quantity must be positive');

    const db = getDb();
    const eventTime = occurredAt ? parseInt(occurredAt, 10) : Date.now();
    const now = Date.now();

    // 1. Idempotency Check: Check if eventId was already processed
    const existingEvent = db.prepare('SELECT * FROM collection_events WHERE id = ?').get(eventId);
    if (existingEvent) {
      const player = db.prepare('SELECT public_player_id FROM players WHERE id = ?').get(existingEvent.player_id);
      const item = db.prepare(`
        SELECT ci.id, ci.name, ci.category, r.name as rarity_name, pi.quantity
        FROM catalog_items ci
        JOIN rarities r ON ci.rarity_id = r.id
        LEFT JOIN player_inventory pi ON pi.item_id = ci.id AND pi.player_id = ?
        WHERE ci.id = ?
      `).get(existingEvent.player_id, itemId);

      const stats = PlayerService.getPlayerStats(existingEvent.player_id);

      return {
        success: true,
        idempotentReplay: true,
        publicPlayerId: player ? player.public_player_id : null,
        item: {
          id: item.id,
          name: item.name,
          category: item.category,
          rarity: item.rarity_name,
          newQuantity: item.quantity || 0,
          wasFirstDiscovery: false
        },
        stats
      };
    }

    // 2. Resolve player (or auto-create with minimal placeholder)
    let player = db.prepare('SELECT * FROM players WHERE youtube_channel_id = ?').get(youtubeChannelId);
    if (!player) {
      const created = PlayerService.upsertPlayer({
        youtubeChannelId,
        displayName: 'Collector_' + youtubeChannelId.slice(-4),
        avatarUrl: ''
      });
      player = db.prepare('SELECT * FROM players WHERE id = ?').get(created.id);
    }

    // 3. Verify item exists in catalogue
    const itemCatalog = db.prepare(`
      SELECT ci.*, r.name as rarity_name, r.display_color as rarity_color
      FROM catalog_items ci
      JOIN rarities r ON ci.rarity_id = r.id
      WHERE ci.id = ?
    `).get(itemId);

    if (!itemCatalog) {
      throw new Error(`Catalogue item '${itemId}' does not exist`);
    }

    // 4. Update or Insert Player Inventory
    const existingInv = db.prepare('SELECT quantity FROM player_inventory WHERE player_id = ? AND item_id = ?').get(player.id, itemId);

    let newQuantity = quantity;
    let wasFirstDiscovery = true;

    if (existingInv) {
      wasFirstDiscovery = (existingInv.quantity === 0);
      newQuantity = existingInv.quantity + quantity;
      db.prepare(`
        UPDATE player_inventory 
        SET quantity = ?, last_found_at = ?, updated_at = ?
        WHERE player_id = ? AND item_id = ?
      `).run(newQuantity, eventTime, now, player.id, itemId);
    } else {
      db.prepare(`
        INSERT INTO player_inventory (player_id, item_id, quantity, first_found_at, last_found_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(player.id, itemId, newQuantity, eventTime, eventTime, now);
    }

    // 5. Insert Collection Event Ledger Entry
    db.prepare(`
      INSERT INTO collection_events (id, player_id, item_id, event_type, quantity_delta, source, reference_id, occurred_at, received_at)
      VALUES (?, ?, ?, 'found', ?, ?, ?, ?, ?)
    `).run(eventId, player.id, itemId, quantity, source, referenceId || null, eventTime, now);

    // 6. Evaluate Achievements
    const { awarded } = AchievementService.evaluatePlayerAchievements(player.id);

    // 7. Calculate updated player statistics
    const stats = PlayerService.getPlayerStats(player.id);

    // 8. Broadcast Real-time Server-Sent Events to open profiles
    sseService.broadcastToPlayer(player.public_player_id, 'inventory_updated', {
      type: 'inventory_updated',
      itemId,
      itemName: itemCatalog.name,
      category: itemCatalog.category,
      rarity: itemCatalog.rarity_name,
      rarityColor: itemCatalog.rarity_color,
      delta: quantity,
      newQuantity,
      isDiscovered: true,
      wasFirstDiscovery,
      timestamp: now
    });

    sseService.broadcastToPlayer(player.public_player_id, 'stats_updated', stats);

    for (const ach of awarded) {
      sseService.broadcastToPlayer(player.public_player_id, 'achievement_unlocked', ach);
    }

    return {
      success: true,
      idempotentReplay: false,
      publicPlayerId: player.public_player_id,
      item: {
        id: itemCatalog.id,
        name: itemCatalog.name,
        category: itemCatalog.category,
        rarity: itemCatalog.rarity_name,
        newQuantity,
        wasFirstDiscovery
      },
      stats
    };
  }

  /**
   * Two-Phase Sale: Phase 1 (Reserve items before bot credits points)
   */
  static reserveSale({ reservationId, youtubeChannelId, itemId, quantity = 1 }) {
    if (!reservationId) throw new Error('reservationId is required');
    if (!youtubeChannelId) throw new Error('youtubeChannelId is required');
    if (!itemId) throw new Error('itemId is required');
    if (quantity <= 0) throw new Error('quantity must be positive');

    const db = getDb();
    const now = Date.now();
    const expiresAt = now + 60000; // 60 seconds reservation window

    // Check if reservation already exists (idempotent reserve call)
    const existingRes = db.prepare('SELECT * FROM sales_reservations WHERE id = ?').get(reservationId);
    if (existingRes) {
      return {
        success: true,
        reservationId: existingRes.id,
        status: existingRes.status,
        itemId: existingRes.item_id,
        quantityReserved: existingRes.quantity,
        expiresAt: existingRes.expires_at,
        isReplay: true
      };
    }

    // Resolve player
    const player = db.prepare('SELECT id, public_player_id FROM players WHERE youtube_channel_id = ?').get(youtubeChannelId);
    if (!player) throw new Error('Player not found');

    // Check item & inventory
    const item = db.prepare('SELECT id, name, base_sale_value FROM catalog_items WHERE id = ?').get(itemId);
    if (!item) throw new Error('Catalogue item not found');

    const inv = db.prepare('SELECT quantity FROM player_inventory WHERE player_id = ? AND item_id = ?').get(player.id, itemId);
    const owned = inv ? inv.quantity : 0;

    // Check active unexpired reservations
    const resRow = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as reserved_total
      FROM sales_reservations
      WHERE player_id = ? AND item_id = ? AND status = 'reserved' AND expires_at > ?
    `).get(player.id, itemId, now);

    const currentlyReserved = resRow ? resRow.reserved_total : 0;
    const available = owned - currentlyReserved;

    if (available < quantity) {
      const err = new Error(`Player owns ${owned} (${currentlyReserved} reserved), but requested to sell ${quantity}`);
      err.code = 'INSUFFICIENT_QUANTITY';
      err.available = available;
      err.owned = owned;
      throw err;
    }

    // Record reservation
    db.prepare(`
      INSERT INTO sales_reservations (id, player_id, item_id, quantity, status, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?)
    `).run(reservationId, player.id, itemId, quantity, expiresAt, now, now);

    return {
      success: true,
      reservationId,
      status: 'reserved',
      itemId,
      quantityReserved: quantity,
      remainingAvailable: available - quantity,
      suggestedSaleValueTotal: (item.base_sale_value || 0) * quantity,
      expiresAt
    };
  }

  /**
   * Two-Phase Sale: Phase 2A (Commit sale after bot successfully credits points)
   */
  static commitSale({ reservationId }) {
    if (!reservationId) throw new Error('reservationId is required');

    const db = getDb();
    const now = Date.now();

    const reservation = db.prepare('SELECT * FROM sales_reservations WHERE id = ?').get(reservationId);
    if (!reservation) throw new Error('Reservation ID not found');

    if (reservation.status === 'committed') {
      // Idempotent commit return
      return {
        success: true,
        status: 'committed',
        reservationId,
        isReplay: true
      };
    }

    if (reservation.status !== 'reserved') {
      throw new Error(`Cannot commit reservation with status '${reservation.status}'`);
    }

    if (reservation.expires_at < now) {
      db.prepare("UPDATE sales_reservations SET status = 'expired', updated_at = ? WHERE id = ?").run(now, reservationId);
      const err = new Error('Reservation has expired');
      err.code = 'RESERVATION_EXPIRED';
      throw err;
    }

    // Deduct inventory
    const inv = db.prepare('SELECT quantity FROM player_inventory WHERE player_id = ? AND item_id = ?').get(reservation.player_id, reservation.item_id);
    const currentQty = inv ? inv.quantity : 0;
    const newQty = Math.max(0, currentQty - reservation.quantity);

    db.prepare(`
      UPDATE player_inventory 
      SET quantity = ?, updated_at = ?
      WHERE player_id = ? AND item_id = ?
    `).run(newQty, now, reservation.player_id, reservation.item_id);

    // Update reservation status
    db.prepare("UPDATE sales_reservations SET status = 'committed', updated_at = ? WHERE id = ?").run(now, reservationId);

    // Record collection sale event
    const saleEventId = 'sale_' + reservationId;
    db.prepare(`
      INSERT INTO collection_events (id, player_id, item_id, event_type, quantity_delta, source, reference_id, occurred_at, received_at)
      VALUES (?, ?, ?, 'sold', ?, 'sale', ?, ?, ?)
    `).run(saleEventId, reservation.player_id, reservation.item_id, -reservation.quantity, reservationId, now, now);

    // Evaluate Achievements and revoke any whose threshold is no longer met
    const { revoked } = AchievementService.evaluatePlayerAchievements(reservation.player_id);

    const player = db.prepare('SELECT public_player_id FROM players WHERE id = ?').get(reservation.player_id);
    const itemCatalog = db.prepare(`
      SELECT ci.*, r.name as rarity_name, r.display_color as rarity_color
      FROM catalog_items ci
      JOIN rarities r ON ci.rarity_id = r.id
      WHERE ci.id = ?
    `).get(reservation.item_id);

    const stats = PlayerService.getPlayerStats(reservation.player_id);
    const isStillDiscovered = newQty > 0;

    // Broadcast SSE updates
    if (player) {
      sseService.broadcastToPlayer(player.public_player_id, 'inventory_updated', {
        type: 'inventory_updated',
        itemId: reservation.item_id,
        itemName: itemCatalog.name,
        category: itemCatalog.category,
        rarity: itemCatalog.rarity_name,
        rarityColor: itemCatalog.rarity_color,
        delta: -reservation.quantity,
        newQuantity: newQty,
        isDiscovered: isStillDiscovered,
        timestamp: now
      });

      sseService.broadcastToPlayer(player.public_player_id, 'stats_updated', stats);

      for (const badge of revoked) {
        sseService.broadcastToPlayer(player.public_player_id, 'achievement_revoked', badge);
      }
    }

    return {
      success: true,
      status: 'committed',
      publicPlayerId: player ? player.public_player_id : null,
      itemId: reservation.item_id,
      quantitySold: reservation.quantity,
      newQuantity: newQty,
      isStillDiscovered,
      badgesRevoked: revoked.map(b => b.name)
    };
  }

  /**
   * Two-Phase Sale: Phase 2B (Cancel reservation if bot points crediting fails)
   */
  static cancelSale({ reservationId, reason = '' }) {
    if (!reservationId) throw new Error('reservationId is required');

    const db = getDb();
    const now = Date.now();

    const reservation = db.prepare('SELECT * FROM sales_reservations WHERE id = ?').get(reservationId);
    if (!reservation) throw new Error('Reservation ID not found');

    if (reservation.status === 'committed') {
      throw new Error('Cannot cancel an already committed sale');
    }

    db.prepare("UPDATE sales_reservations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, reservationId);

    return {
      success: true,
      status: 'cancelled',
      reservationId,
      message: 'Reserved items returned to player available inventory'
    };
  }

  /**
   * Fetches collection for public display with filtering, discovery state, and sorting.
   */
  static getCategoryCollection({
    publicPlayerId,
    category = 'all',
    rarityFilter = null,
    statusFilter = null,
    sortBy = 'rarity'
  }) {
    const db = getDb();

    const player = db.prepare('SELECT id, public_player_id, display_name FROM players WHERE public_player_id = ?').get(publicPlayerId);
    if (!player) return null;

    // Build query for catalog items
    let query = `
      SELECT 
        ci.id, ci.category, ci.name, ci.description, ci.image_url, ci.sort_order, ci.active,
        r.id as rarity_id, r.name as rarity_name, r.display_color as rarity_color, r.sort_order as rarity_sort,
        COALESCE(pi.quantity, 0) as quantity,
        pi.first_found_at, pi.last_found_at
      FROM catalog_items ci
      JOIN rarities r ON ci.rarity_id = r.id
      LEFT JOIN player_inventory pi ON pi.item_id = ci.id AND pi.player_id = ?
      WHERE ci.active = 1
    `;
    const params = [player.id];

    if (category && category !== 'all') {
      query += ` AND ci.category = ?`;
      params.push(category);
    }

    if (rarityFilter) {
      query += ` AND r.id = ?`;
      params.push(rarityFilter);
    }

    // Sort order
    if (sortBy === 'quantity') {
      query += ` ORDER BY COALESCE(pi.quantity, 0) DESC, r.sort_order DESC, ci.name ASC`;
    } else if (sortBy === 'name') {
      query += ` ORDER BY ci.name ASC`;
    } else {
      // Default: rarity
      query += ` ORDER BY r.sort_order DESC, ci.sort_order ASC, ci.name ASC`;
    }

    const rows = db.prepare(query).all(...params);

    let discoveredCount = 0;
    let totalCount = 0;

    const mappedItems = rows.map(r => {
      const isDiscovered = r.quantity > 0;
      if (isDiscovered) discoveredCount++;
      totalCount++;

      return {
        id: r.id,
        category: r.category,
        name: r.name,
        description: r.description,
        imageUrl: r.image_url,
        rarityId: r.rarity_id,
        rarityName: r.rarity_name,
        rarityColor: r.rarity_color,
        quantity: r.quantity,
        isDiscovered,
        firstFoundAt: r.first_found_at,
        lastFoundAt: r.last_found_at
      };
    });

    // Apply status filter in memory if requested
    let filteredItems = mappedItems;
    if (statusFilter === 'discovered') {
      filteredItems = mappedItems.filter(i => i.isDiscovered);
    } else if (statusFilter === 'undiscovered') {
      filteredItems = mappedItems.filter(i => !i.isDiscovered);
    }

    const completionPercentage = totalCount > 0 ? Math.round((discoveredCount / totalCount) * 1000) / 10 : 0;

    return {
      category,
      summary: {
        discovered: discoveredCount,
        total: totalCount,
        completionPercentage
      },
      items: filteredItems
    };
  }
}
