import test from 'node:test';
import assert from 'node:assert';
import { createTestRouter, dispatch } from './testHelper.js';
import { config } from '../server/config.js';

test('Public API & Privacy Security Suite', async (t) => {
  const router = createTestRouter();

  // Create self-contained test fixture player
  const setupRes = await dispatch(router, {
    method: 'POST',
    url: '/api/v1/bot/players/upsert',
    headers: { 'authorization': `Bearer ${config.botApiSecret}` },
    body: {
      youtubeChannelId: 'UC_test_public_suite_99',
      displayName: 'PublicTestCollector',
      avatarUrl: 'https://example.com/avatar.jpg'
    }
  });
  const testPlayerId = setupRes.json.player.publicPlayerId;

  // Add 1 test collectible
  await dispatch(router, {
    method: 'POST',
    url: '/api/v1/bot/collection-events',
    headers: { 'authorization': `Bearer ${config.botApiSecret}` },
    body: {
      eventId: 'evt_test_pub_99_' + Date.now(),
      youtubeChannelId: 'UC_test_public_suite_99',
      itemId: 'fish_acrone_crimson_kraken',
      quantity: 1,
      source: 'fishing'
    }
  });

  await t.test('Public player profile returns correct structure without login', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${testPlayerId}`
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.json.player);
    assert.strictEqual(res.json.player.displayName, 'PublicTestCollector');
    assert.strictEqual(res.json.player.publicPlayerId, testPlayerId);
    assert.ok(res.json.stats);
    assert.ok(res.json.stats.categories.fish);
    assert.ok(res.json.stats.categories.mining);
    assert.ok(res.json.stats.categories.chest);
  });

  await t.test('PRIVACY AUDIT: Public API never exposes private YouTube Channel ID or points balance', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${testPlayerId}`
    });

    const responseText = res.text;

    // Check for YouTube Channel ID leak
    assert.strictEqual(responseText.includes('UC_test_public_suite_99'), false, 'Leaked YouTube Channel ID!');
    assert.strictEqual(responseText.includes('youtube_channel_id'), false, 'Exposed youtube_channel_id key!');

    // Check for points or balance leak
    assert.strictEqual(responseText.includes('points_balance'), false, 'Exposed points_balance!');
    assert.strictEqual(responseText.includes('acrone_points'), false, 'Exposed acrone_points!');

    // Check for secret leaks
    assert.strictEqual(responseText.includes('botApiSecret'), false, 'Exposed secret!');
  });

  await t.test('Returns 404 for non-existent player profile', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: '/api/public/players/usr_does_not_exist_9999'
    });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.json.error, 'PLAYER_NOT_FOUND');
  });

  await t.test('Public player profile can be accessed by display name as well as publicPlayerId', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: '/api/public/players/PublicTestCollector'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.player.displayName, 'PublicTestCollector');
    assert.strictEqual(res.json.player.publicPlayerId, testPlayerId);
  });

  await t.test('Returns active catalogue and rarity definitions', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: '/api/public/catalog'
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.json.rarities));
    assert.strictEqual(res.json.rarities.length, 6);
    assert.ok(res.json.itemsCount >= 135);
  });

  await t.test('Category collection filtering by rarity and discovery status', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${testPlayerId}/collection?category=fish&rarity=mythic`
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.json.items));
    for (const item of res.json.items) {
      assert.strictEqual(item.rarityId, 'mythic');
    }
  });

  await t.test('Achievements API returns unlocked and locked badges', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: `/api/public/players/${testPlayerId}/achievements`
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.json.totalCount >= 10);
  });

  await t.test('Player search endpoint matches query', async () => {
    const res = await dispatch(router, {
      method: 'GET',
      url: '/api/public/search?query=PublicTest'
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.json.count >= 1);
    assert.strictEqual(res.json.results[0].displayName, 'PublicTestCollector');
  });
});
