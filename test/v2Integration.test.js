import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createTestRouter, generateHmacHeaders, dispatch } from './testHelper.js';
import { config, validateProductionConfig } from '../server/config.js';
import { queryOne } from '../server/db/index.js';

test('Acrone Points V2 & Vercel Production Readiness Suite', async (t) => {
  const router = createTestRouter();
  const testChannel = 'UC_v2_spec_' + Date.now();
  let publicId = null;

  // 1. Bot Health Check Endpoint
  await t.test('GET /api/v1/bot/health returns healthy status and active catalogue counts', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: '/api/v1/bot/health'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.status, 'healthy');
    assert.strictEqual(res.json.database, 'connected');
    assert.strictEqual(res.json.apiVersion, '2.0.0');
    assert.strictEqual(typeof res.json.timestamp, 'number');
    assert.strictEqual(res.json.catalogue.fish, 60);
    assert.strictEqual(res.json.catalogue.mining, 50);
    assert.strictEqual(res.json.catalogue.chest, 25);
    assert.strictEqual(res.json.catalogue.total, 135);
  });

  // 2. Stable Player Identity (YouTube Channel ID mapping)
  await t.test('POST /api/v1/bot/players/upsert guarantees stable publicPlayerId across name changes', async () => {
    // Initial creation
    const res1 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers: generateHmacHeaders({
        youtubeChannelId: testChannel,
        displayName: 'OriginalName',
        avatarUrl: 'https://yt.com/1.jpg'
      }),
      body: {
        youtubeChannelId: testChannel,
        displayName: 'OriginalName',
        avatarUrl: 'https://yt.com/1.jpg'
      }
    });

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.json.success, true);
    assert.strictEqual(res1.json.player.isNewPlayer, true);
    publicId = res1.json.player.publicPlayerId;
    assert.ok(publicId.startsWith('usr_'));

    // Second call: Updated display name and avatar for the same YouTube ID
    const res2 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers: generateHmacHeaders({
        youtubeChannelId: testChannel,
        displayName: 'RenamedCollector',
        avatarUrl: 'https://yt.com/2.jpg'
      }),
      body: {
        youtubeChannelId: testChannel,
        displayName: 'RenamedCollector',
        avatarUrl: 'https://yt.com/2.jpg'
      }
    });

    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.json.success, true);
    assert.strictEqual(res2.json.player.isNewPlayer, false);
    // Public ID must remain unchanged
    assert.strictEqual(res2.json.player.publicPlayerId, publicId);
    assert.strictEqual(res2.json.player.displayName, 'RenamedCollector');
  });

  // 3. Catalogue Ingestion & Synchronization
  await t.test('GET /api/v1/bot/catalog returns active items and base sale values', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: '/api/v1/bot/catalog',
      headers: generateHmacHeaders('')
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.count >= 135, true);
    const kraken = res.json.items.find((i) => i.id === 'fish_acrone_crimson_kraken');
    assert.ok(kraken);
    assert.strictEqual(kraken.base_sale_value, 5000);
  });

  await t.test('POST /api/v1/bot/catalog/sync safely updates items without resetting inventory', async () => {
    // Sync an update to an existing item's sale value
    const syncRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/catalog/sync',
      headers: generateHmacHeaders({
        items: [
          {
            id: 'fish_common_sardine',
            category: 'fish',
            name: 'Common Sardine',
            rarityId: 'common',
            baseSaleValue: 15
          }
        ]
      }),
      body: {
        items: [
          {
            id: 'fish_common_sardine',
            category: 'fish',
            name: 'Common Sardine',
            rarityId: 'common',
            baseSaleValue: 15
          }
        ]
      }
    });

    assert.strictEqual(syncRes.status, 200);
    assert.strictEqual(syncRes.json.success, true);
    assert.strictEqual(syncRes.json.count, 1);

    // Verify update took effect in database
    const row = await queryOne('SELECT base_sale_value FROM catalog_items WHERE id = ?', ['fish_common_sardine']);
    assert.strictEqual(row.base_sale_value, 15);
  });

  // 4. Collection Events & Player Snapshot
  await t.test('POST /api/v1/bot/collection-events & GET /api/v1/bot/players/snapshot', async () => {
    // Award 2 sardines and 1 koi
    const evt1 = 'evt_v2_' + crypto.randomUUID();
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/collection-events',
      headers: generateHmacHeaders({
        eventId: evt1,
        youtubeChannelId: testChannel,
        itemId: 'fish_common_sardine',
        quantity: 2,
        source: 'fishing'
      }),
      body: {
        eventId: evt1,
        youtubeChannelId: testChannel,
        itemId: 'fish_common_sardine',
        quantity: 2,
        source: 'fishing'
      }
    });

    const evt2 = 'evt_v2_' + crypto.randomUUID();
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/collection-events',
      headers: generateHmacHeaders({
        eventId: evt2,
        youtubeChannelId: testChannel,
        itemId: 'fish_golden_koi',
        quantity: 1,
        source: 'fishing'
      }),
      body: {
        eventId: evt2,
        youtubeChannelId: testChannel,
        itemId: 'fish_golden_koi',
        quantity: 1,
        source: 'fishing'
      }
    });

    // Request snapshot by youtubeChannelId
    const snapRes = await dispatch(router, {
      method: 'GET',
      url: `/api/v1/bot/players/snapshot?youtubeChannelId=${encodeURIComponent(testChannel)}`,
      headers: generateHmacHeaders('')
    });

    assert.strictEqual(snapRes.status, 200);
    assert.strictEqual(snapRes.json.success, true);
    assert.strictEqual(snapRes.json.player.publicPlayerId, publicId);
    assert.strictEqual(snapRes.json.inventory.length >= 2, true);
    const sardine = snapRes.json.inventory.find((i) => i.itemId === 'fish_common_sardine');
    assert.strictEqual(sardine.quantity, 2);
    assert.strictEqual(snapRes.json.stats.uniqueItemTypes, 2);
    assert.strictEqual(snapRes.json.stats.totalQuantity, 3);
  });

  // 5. Two-Phase Selling: Reserve -> Cancel & Reserve -> Commit
  await t.test('Two-Phase Sale: Full life-cycle (Reserve, Cancel, Re-reserve, Commit)', async () => {
    const resId1 = 'res_test_' + crypto.randomUUID();

    // Reserve 1 sardine
    const reserveRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: generateHmacHeaders({
        reservationId: resId1,
        youtubeChannelId: testChannel,
        itemId: 'fish_common_sardine',
        quantity: 1
      }),
      body: {
        reservationId: resId1,
        youtubeChannelId: testChannel,
        itemId: 'fish_common_sardine',
        quantity: 1
      }
    });

    assert.strictEqual(reserveRes.status, 200);
    assert.strictEqual(reserveRes.json.status, 'reserved');
    assert.strictEqual(reserveRes.json.quantityReserved, 1);
    assert.strictEqual(reserveRes.json.remainingAvailable, 1); // 2 owned - 1 reserved = 1 remaining

    // Cancel reservation (e.g. Streamer.bot points credit failed locally)
    const cancelRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/cancel',
      headers: generateHmacHeaders({
        reservationId: resId1,
        reason: 'Bot simulated point crediting error'
      }),
      body: {
        reservationId: resId1,
        reason: 'Bot simulated point crediting error'
      }
    });

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.json.status, 'cancelled');

    // New reservation for committed sale
    const resId2 = 'res_commit_' + crypto.randomUUID();
    await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: generateHmacHeaders({
        reservationId: resId2,
        youtubeChannelId: testChannel,
        itemId: 'fish_common_sardine',
        quantity: 1
      }),
      body: {
        reservationId: resId2,
        youtubeChannelId: testChannel,
        itemId: 'fish_common_sardine',
        quantity: 1
      }
    });

    // Commit sale
    const commitRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/commit',
      headers: generateHmacHeaders({ reservationId: resId2 }),
      body: { reservationId: resId2 }
    });

    assert.strictEqual(commitRes.status, 200);
    assert.strictEqual(commitRes.json.status, 'committed');
    assert.strictEqual(commitRes.json.quantitySold, 1);
    assert.strictEqual(commitRes.json.newQuantity, 1); // was 2, now 1
  });

  // 6. Direct Achievement Sync
  await t.test('POST /api/v1/bot/achievements/sync authorizes badge grant and revoke', async () => {
    // Unlock
    const unlockRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/achievements/sync',
      headers: generateHmacHeaders({
        youtubeChannelId: testChannel,
        achievementId: 'ach_first_catch',
        action: 'unlock'
      }),
      body: {
        youtubeChannelId: testChannel,
        achievementId: 'ach_first_catch',
        action: 'unlock'
      }
    });

    assert.strictEqual(unlockRes.status, 200);
    assert.strictEqual(unlockRes.json.status, 'unlocked');

    // Revoke
    const revokeRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/achievements/sync',
      headers: generateHmacHeaders({
        youtubeChannelId: testChannel,
        achievementId: 'ach_first_catch',
        action: 'revoke'
      }),
      body: {
        youtubeChannelId: testChannel,
        achievementId: 'ach_first_catch',
        action: 'revoke'
      }
    });

    assert.strictEqual(revokeRes.status, 200);
    assert.strictEqual(revokeRes.json.status, 'revoked');
  });

  // 7. Recent Events API for Serverless Real-time Catch-up
  await t.test('GET /api/public/players/:publicPlayerId/events returns recent collection events', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${publicId}/events?since=0`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.publicPlayerId, publicId);
    assert.strictEqual(Array.isArray(res.json.events), true);
    assert.strictEqual(res.json.events.length >= 2, true);
  });

  // 8. Security & Production Enforcement
  await t.test('validateProductionConfig throws fatal error if production secret or Turso URL is missing', () => {
    const originalEnv = config.nodeEnv;
    const originalSecret = config.botApiSecret;
    const originalTurso = config.tursoDatabaseUrl;

    try {
      config.isProduction = true;
      config.botApiSecret = 'acrone_dev_secret_change_in_production_998877';
      config.tursoDatabaseUrl = '';

      assert.throws(() => {
        validateProductionConfig();
      }, /FATAL/);
    } finally {
      config.isProduction = false;
      config.botApiSecret = originalSecret;
      config.tursoDatabaseUrl = originalTurso;
    }
  });

  await t.test('Bearer auth is rejected when in production environment', async () => {
    const originalProd = config.isProduction;
    try {
      config.isProduction = true;
      const res = await dispatch(router, {
        method: 'POST',
        url: '/api/v1/bot/players/upsert',
        headers: { 'authorization': `Bearer ${config.botApiSecret}` },
        body: { youtubeChannelId: 'UC_prod_bearer' }
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.error, 'BEARER_DISABLED_IN_PRODUCTION');
    } finally {
      config.isProduction = originalProd;
    }
  });

  // 9. Vercel & Entry Point Compatibility
  await t.test('Entry points (server.js and api/index.js) export valid application request handler', async () => {
    const serverModule = await import('../server.js');
    const apiModule = await import('../api/index.js');

    assert.strictEqual(typeof serverModule.default, 'function');
    assert.strictEqual(typeof serverModule.app, 'function');
    assert.strictEqual(typeof serverModule.createServer, 'function');
    assert.strictEqual(typeof apiModule.default, 'function');

    // Helper to simulate request through api/index.js
    const simulateApiRequest = (url, headers = {}) => {
      return new Promise((resolve) => {
        const req = new EventEmitter();
        req.url = url;
        req.method = 'GET';
        req.headers = { host: 'localhost:3000', ...headers };
        setTimeout(() => req.emit('end'), 5);

        const res = new EventEmitter();
        let statusCode = 200;
        let body = '';
        res.setHeader = () => {};
        res.getHeader = () => null;
        res.writeHead = (code) => { statusCode = code; };
        res.status = (code) => { statusCode = code; return res; };
        res.json = (data) => resolve({ statusCode, data });
        res.end = (chunk) => {
          if (chunk) body += chunk;
          try { resolve({ statusCode, data: JSON.parse(body) }); }
          catch (_) { resolve({ statusCode, data: body }); }
        };

        apiModule.default(req, res);
      });
    };

    // Verify Vercel rewrite with __path restores /api/v1/bot/health
    const resPath = await simulateApiRequest('/api/index.js?__path=/api/v1/bot/health');
    assert.strictEqual(resPath.statusCode, 200);
    assert.strictEqual(resPath.data.status, 'healthy');

    // Verify Vercel rewrite preserves original query parameters
    const resQuery = await simulateApiRequest('/api/index.js?__path=/api/public/search&query=Collector');
    assert.strictEqual(resQuery.statusCode, 200);
    assert.strictEqual(resQuery.data.query, 'Collector');

    // Verify Vercel rewrite via x-matched-path header
    const resHeader = await simulateApiRequest('/api/index.js', { 'x-matched-path': '/api/v1/bot/health' });
    assert.strictEqual(resHeader.statusCode, 200);
    assert.strictEqual(resHeader.data.status, 'healthy');

    // Verify direct invocation
    const resDirect = await simulateApiRequest('/api/v1/bot/health');
    assert.strictEqual(resDirect.statusCode, 200);
    assert.strictEqual(resDirect.data.status, 'healthy');
  });

  // 10. Two-Phase Sale Edge Cases: Expiry & Insufficient Quantity
  await t.test('Rejects reserving more items than owned with 400 INSUFFICIENT_QUANTITY', async () => {
    const resIdOversell = 'res_oversell_' + crypto.randomUUID();
    const payload = {
      reservationId: resIdOversell,
      youtubeChannelId: testChannel,
      itemId: 'fish_common_sardine',
      quantity: 9999
    };

    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/sales/reserve',
      headers: generateHmacHeaders(payload),
      body: payload
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.error, 'INSUFFICIENT_QUANTITY');
  });

  // 11. Public Balance Synchronization & Monotonic Revision Guard
  await t.test('POST /api/v1/bot/players/balance/sync updates balance and enforces monotonic revisions', async () => {
    const syncChannel = 'UC_balance_test_' + crypto.randomUUID().substring(0, 8);

    // Initial upsert of player
    const upsertRes = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers: generateHmacHeaders({ youtubeChannelId: syncChannel, displayName: 'BalanceTester' }),
      body: { youtubeChannelId: syncChannel, displayName: 'BalanceTester' }
    });
    assert.strictEqual(upsertRes.status, 200);
    const pubId = upsertRes.json.player.publicPlayerId;

    // Check initial public profile balance is 0
    const prof0 = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${pubId}`
    });
    assert.strictEqual(prof0.status, 200);
    assert.strictEqual(prof0.json.player.balance, 0);

    // Sync balance: 50,000 AP at revision 1
    const sync1 = {
      youtubeChannelId: syncChannel,
      balance: 50000,
      revision: 1,
      eventId: 'evt_bal_1_' + crypto.randomUUID()
    };
    const resSync1 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/balance/sync',
      headers: generateHmacHeaders(sync1),
      body: sync1
    });
    assert.strictEqual(resSync1.status, 200);
    assert.strictEqual(resSync1.json.success, true);
    assert.strictEqual(resSync1.json.balance, 50000);
    assert.strictEqual(resSync1.json.revision, 1);

    // Verify public profile returns updated balance
    const prof1 = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${pubId}`
    });
    assert.strictEqual(prof1.status, 200);
    assert.strictEqual(prof1.json.player.balance, 50000);

    // Sync newer balance: 75,000 AP at revision 2
    const sync2 = {
      youtubeChannelId: syncChannel,
      balance: 75000,
      revision: 2,
      eventId: 'evt_bal_2_' + crypto.randomUUID()
    };
    const resSync2 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/balance/sync',
      headers: generateHmacHeaders(sync2),
      body: sync2
    });
    assert.strictEqual(resSync2.status, 200);
    assert.strictEqual(resSync2.json.balance, 75000);
    assert.strictEqual(resSync2.json.revision, 2);

    // Attempt stale sync: older revision 1 trying to overwrite revision 2
    const staleSync = {
      youtubeChannelId: syncChannel,
      balance: 10000,
      revision: 1,
      eventId: 'evt_stale_' + crypto.randomUUID()
    };
    const resStale = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/balance/sync',
      headers: generateHmacHeaders(staleSync),
      body: staleSync
    });
    assert.strictEqual(resStale.status, 200);
    assert.strictEqual(resStale.json.stale, true);
    assert.strictEqual(resStale.json.balance, 75000, 'Balance must remain 75000 from revision 2');
    assert.strictEqual(resStale.json.revision, 2);

    // Re-verify public profile still displays 75000
    const profFinal = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${pubId}`
    });
    assert.strictEqual(profFinal.status, 200);
    assert.strictEqual(profFinal.json.player.balance, 75000);
  });
});
