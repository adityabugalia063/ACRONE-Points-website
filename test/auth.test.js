import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createTestRouter, generateHmacHeaders, dispatch } from './testHelper.js';
import { config } from '../server/config.js';

test('Bot Authentication & Security Suite', async (t) => {
  const router = createTestRouter();

  await t.test('Rejects bot call without any auth headers with 401', async () => {
    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      body: { youtubeChannelId: 'UC_test_1' }
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.error, 'UNAUTHORIZED');
  });

  await t.test('Accepts bot call with valid Bearer token', async () => {
    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers: {
        'authorization': `Bearer ${config.botApiSecret}`
      },
      body: {
        youtubeChannelId: 'UC_test_bearer_' + Date.now(),
        displayName: 'BearerUser'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.player.displayName, 'BearerUser');
  });

  await t.test('Accepts bot call with valid HMAC-SHA256 signature', async () => {
    const body = {
      youtubeChannelId: 'UC_test_hmac_' + Date.now(),
      displayName: 'HmacUser'
    };
    const headers = generateHmacHeaders(body);

    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers,
      body
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.success, true);
    assert.strictEqual(res.json.player.displayName, 'HmacUser');
  });

  await t.test('Rejects bot call with forged HMAC signature', async () => {
    const body = {
      youtubeChannelId: 'UC_test_forged',
      displayName: 'Attacker'
    };
    const headers = generateHmacHeaders(body, 'wrong_secret_12345');

    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers,
      body
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.error, 'INVALID_SIGNATURE');
  });

  await t.test('Rejects bot call with expired timestamp (> 5 mins drift)', async () => {
    const body = { youtubeChannelId: 'UC_test_drift' };
    const staleTime = Date.now() - (6 * 60 * 1000); // 6 minutes ago
    const headers = generateHmacHeaders(body, config.botApiSecret, staleTime);

    const res = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers,
      body
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.error, 'TIMESTAMP_EXPIRED');
  });

  await t.test('Rejects replayed nonce attack', async () => {
    const body = { youtubeChannelId: 'UC_test_replay' };
    const fixedNonce = 'nonce_replay_' + crypto.randomUUID();
    const headers = generateHmacHeaders(body, config.botApiSecret, Date.now(), fixedNonce);

    // First call: should succeed
    const res1 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers,
      body
    });
    assert.strictEqual(res1.status, 200);

    // Second call with same nonce: should be rejected
    const res2 = await dispatch(router, {
      method: 'POST',
      url: '/api/v1/bot/players/upsert',
      headers,
      body
    });
    assert.strictEqual(res2.status, 401);
    assert.strictEqual(res2.json.error, 'NONCE_REPLAY_DETECTED');
  });
});
