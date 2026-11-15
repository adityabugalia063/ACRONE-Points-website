import crypto from 'node:crypto';
import { Router } from '../server/router.js';
import { registerBotRoutes } from '../server/routes/botRoutes.js';
import { registerPublicRoutes } from '../server/routes/publicRoutes.js';
import { config } from '../server/config.js';

export function createTestRouter() {
  const router = new Router();
  registerBotRoutes(router);
  registerPublicRoutes(router);
  return router;
}

export function generateHmacHeaders(body, secret = config.botApiSecret, customTimestamp = null, customNonce = null) {
  const timestamp = customTimestamp !== null ? customTimestamp : Date.now();
  const nonce = customNonce !== null ? customNonce : crypto.randomUUID();
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body || {});

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${nonce}.${bodyString}`);
  const signature = hmac.digest('hex');

  return {
    'x-bot-timestamp': String(timestamp),
    'x-bot-nonce': nonce,
    'x-bot-signature': signature
  };
}

export async function dispatch(router, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const rawBody = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const parsedBody = body ? (typeof body === 'string' ? JSON.parse(body) : body) : {};

    const req = {
      method: method.toUpperCase(),
      url,
      headers: { ...headers },
      rawBody,
      body: parsedBody
    };

    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(name, val) { this.headers[name.toLowerCase()] = val; },
      writeHead(code, h = {}) {
        this.statusCode = code;
        for (const [k, v] of Object.entries(h)) {
          this.headers[k.toLowerCase()] = v;
        }
      },
      end(chunk) {
        if (chunk) this.body += chunk;
        let json = null;
        try {
          json = JSON.parse(this.body);
        } catch (e) {}
        resolve({
          status: this.statusCode,
          headers: this.headers,
          text: this.body,
          json
        });
      }
    };

    router.handle(req, res).then(() => {
      // If handler finished without calling res.end() or res.writeHead()
      if (!res.body && res.statusCode === 200) {
        // give it a tick
        setTimeout(() => {
          let json = null;
          try { json = JSON.parse(res.body); } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, text: res.body, json });
        }, 10);
      }
    });
  });
}
