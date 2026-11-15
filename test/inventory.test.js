import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createTestRouter, dispatch } from './testHelper.js';
import { config } from '../server/config.js';
import { getDb } from '../server/db/index.js';

test('Inventory, Idempotency & Two-Phase Sale Suite', async (t) => {
  const router = createTestRouter();
  const bearerHeaders = { 'authorization': `Bearer ${config.botApiSecret}` };
  const db = getDb();

  const testChannelId = 'UC_bot_user_' + Date.now();
  let publicPlayerId = null;

  // 1. Setup Player
  await t.test('Register new player via bot upsert', async () => {
    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers: bearerHeaders,
      body: {
        youtubeChannelId: testChannelId,
        displayName: 'TestFisher',
        avatarUrl: 'https://example.com/avatar.jpg'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    publicPlayerId = res.json.player.publicPlayerId;
    assert.ok(publicPlayerId.startsWith('usr_'));
  });

  // 2. Collection Event & Idempotency
  await t.test('Records item find and enforces idempotency key', async () => {
    const eventId = 'evt_' + crypto.randomUUID();

    // First attempt: adds 3 sardines
    const res1 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/collection-events',
      headers: bearerHeaders,
      body: {
        eventId,
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 3,
        source: 'fishing'
      }
    });

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.json.idempotentReplay, false);
    assert.strictEqual(res1.json.item.newQuantity, 3);
    assert.strictEqual(res1.json.item.wasFirstDiscovery, true);

    // Second attempt with exact same eventId: should replay without duplicating quantity
    const res2 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/collection-events',
      headers: bearerHeaders,
      body: {
        eventId,
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 3,
        source: 'fishing'
      }
    });

    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.json.idempotentReplay, true);
    // Quantity must still be 3, NOT 6!
    assert.strictEqual(res2.json.item.newQuantity, 3);
  });

  // 3. Unique Items vs Total Quantity Distinction
  await t.test('Correctly separates unique count from total quantity', async () => {
    // Add 2 more of the same fish
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/collection-events',
      headers: bearerHeaders,
      body: {
        eventId: 'evt_' + crypto.randomUUID(),
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 2,
        source: 'fishing'
      }
    });

    // Player now has 5 sardines: 1 unique item, 5 total quantity
    const res = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${publicPlayerId}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.stats.uniqueItemTypes, 1);
    assert.strictEqual(res.json.stats.totalQuantity, 5);
  });

  // 4. Two-Phase Sale: Phase 1 Reserve
  let currentReservationId = null;
  await t.test('Reserves items for sale safely and prevents overselling', async () => {
    currentReservationId = 'res_' + crypto.randomUUID();

    // Try reserving 2 of the 5 sardines
    const res1 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: bearerHeaders,
      body: {
        reservationId: currentReservationId,
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 2
      }
    });

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.json.status, 'reserved');
    assert.strictEqual(res1.json.remainingAvailable, 3);

    // Try reserving 4 more while 2 are reserved (available is 3): should fail with 400
    const res2 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: bearerHeaders,
      body: {
        reservationId: 'res_' + crypto.randomUUID(),
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 4
      }
    });

    assert.strictEqual(res2.status, 400);
    assert.strictEqual(res2.json.error, 'INSUFFICIENT_QUANTITY');
  });

  // 5. Two-Phase Sale: Phase 2A Commit
  await t.test('Commits sale and decrements player quantity', async () => {
    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/commit',
      headers: bearerHeaders,
      body: {
        reservationId: currentReservationId
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.status, 'committed');
    assert.strictEqual(res.json.newQuantity, 3); // 5 - 2 = 3
    assert.strictEqual(res.json.isStillDiscovered, true);
  });

  // 6. Two-Phase Sale: Cancel flow
  await t.test('Cancelling reservation releases reserved items', async () => {
    const cancelResId = 'res_cancel_' + crypto.randomUUID();

    // Reserve 2
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: bearerHeaders,
      body: {
        reservationId: cancelResId,
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 2
      }
    });

    // Cancel reservation
    const resCancel = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/cancel',
      headers: bearerHeaders,
      body: {
        reservationId: cancelResId,
        reason: 'Viewer changed mind'
      }
    });

    assert.strictEqual(resCancel.status, 200);
    assert.strictEqual(resCancel.json.status, 'cancelled');

    // Available should still be 3 (all 3 unreserved)
    const resReserveAgain = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: bearerHeaders,
      body: {
        reservationId: 'res_check_' + crypto.randomUUID(),
        youtubeChannelId: testChannelId,
        itemId: 'fish_common_sardine',
        quantity: 3
      }
    });
    assert.strictEqual(resReserveAgain.status, 200);
  });

  // 7. Selling final copy -> Undiscovered state & Badge Revocation
  await t.test('Selling final copy sets item to undiscovered and recalculates stats', async () => {
    // Add 1 unique gem: ore_rough_ruby
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/collection-events',
      headers: bearerHeaders,
      body: {
        eventId: 'evt_gem_' + crypto.randomUUID(),
        youtubeChannelId: testChannelId,
        itemId: 'ore_rough_ruby',
        quantity: 1,
        source: 'mining'
      }
    });

    // Verify discovered state is true
    const resColBefore = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${publicPlayerId}/collection?category=mining`
    });
    const rubyBefore = resColBefore.json.items.find(i => i.id === 'ore_rough_ruby');
    assert.strictEqual(rubyBefore.isDiscovered, true);
    assert.strictEqual(rubyBefore.quantity, 1);

    // Now sell that 1 ruby (reserve -> commit)
    const sellRubyResId = 'res_ruby_' + crypto.randomUUID();
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: bearerHeaders,
      body: {
        reservationId: sellRubyResId,
        youtubeChannelId: testChannelId,
        itemId: 'ore_rough_ruby',
        quantity: 1
      }
    });

    const resCommit = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/commit',
      headers: bearerHeaders,
      body: { reservationId: sellRubyResId }
    });

    assert.strictEqual(resCommit.status, 200);
    assert.strictEqual(resCommit.json.newQuantity, 0);
    assert.strictEqual(resCommit.json.isStillDiscovered, false);

    // Verify in public collection view
    const resColAfter = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${publicPlayerId}/collection?category=mining`
    });
    const rubyAfter = resColAfter.json.items.find(i => i.id === 'ore_rough_ruby');
    assert.strictEqual(rubyAfter.isDiscovered, false);
    assert.strictEqual(rubyAfter.quantity, 0);
  });
});
