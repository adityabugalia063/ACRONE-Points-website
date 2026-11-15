# ACRONE Collection — Vercel & Turso Cloud Deployment Guide

This guide details the complete, step-by-step procedure to deploy the **ACRONE Collection** website on **Vercel** connected to a hosted **Turso Cloud (libSQL)** database.

---

## 1. Prerequisites & System Requirements

- **Node.js Runtime:** Version **20.x** or **22.x** (Vercel supported Node.js runtimes).
- **GitHub Repository:** [https://github.com/adityabugalia063/ACRONE-Points-website](https://github.com/adityabugalia063/ACRONE-Points-website)
- **Vercel Account:** [https://vercel.com](https://vercel.com)
- **Turso Cloud Account:** [https://turso.tech](https://turso.tech) (or via the Vercel Marketplace Turso Integration)

---

## 2. Architecture on Vercel

```
[YouTube Chat] ──▶ [Streamer.bot Client]
                          │ (HMAC-SHA256 authenticated REST API)
                          ▼
              [Vercel Serverless Platform]
              ├── Static Assets (public/*) ──▶ Instant Global CDN Edge
              ├── SPA Client Routes (/u/*) ──▶ public/index.html
              └── Backend Serverless API ──▶ api/index.js (server/index.js)
                          │
                          ▼
               [Turso Cloud / libSQL]
               (Persistent Relational Database)
```

- **Static Frontend:** HTML, CSS, JavaScript, and 135 SVG icons in `public/` are served at the edge with caching.
- **Serverless API:** Single consolidated router in `server/index.js` exported through `api/index.js` and `server.js`.
- **Database:** Fully managed Turso Cloud SQLite/libSQL database over HTTP/WebSocket.
- **Real-time Sync:** Dual-layer synchronization (instant Server-Sent Events with fallback event reconciliation via `/api/public/players/:id/events?since=...`).

---

## 3. Step 1: Create Your Turso Cloud Database

### Option A: Via Turso Web Dashboard / CLI

1. Sign in to [Turso](https://turso.tech).
2. Create a new database named `acrone-collection`:
   ```bash
   turso db create acrone-collection
   ```
3. Copy your database URL:
   ```bash
   turso db show acrone-collection --url
   # Outputs: libsql://acrone-collection-<your-org>.turso.io
   ```
4. Create an authentication token:
   ```bash
   turso db tokens create acrone-collection
   # Outputs: eyJhbGci...
   ```

### Option B: Via Vercel Marketplace
1. In your Vercel Project Dashboard, navigate to the **Integrations** tab.
2. Search for **Turso** and click **Add Integration**.
3. Select your team and project, and Turso will automatically populate `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in your environment variables.

---

## 4. Step 2: Migrate Initial Schema & Catalogue to Turso

Before your first deployment (or whenever updating existing local SQLite data), run the migration tool from your local terminal:

```bash
# On Windows (PowerShell):
$env:TURSO_DATABASE_URL="libsql://acrone-collection-<your-org>.turso.io"
$env:TURSO_AUTH_TOKEN="<your-turso-token>"
npm run migrate:turso

# On Linux / macOS / Bash:
TURSO_DATABASE_URL="libsql://acrone-collection-<your-org>.turso.io" \
TURSO_AUTH_TOKEN="<your-turso-token>" \
npm run migrate:turso
```

The script will:
1. Initialize the relational schema (8 tables, indexes, constraints).
2. Migrate all 135 catalogue items (60 fish, 50 minerals, 25 chest items) and 10 achievements.
3. Migrate any existing player profiles and inventories without loss.
4. Verify table row counts and display a verification summary table.

---

## 5. Step 3: Deploy to Vercel

1. Log in to [Vercel](https://vercel.com) and click **Add New... > Project**.
2. Select your GitHub repository: `adityabugalia063/ACRONE-Points-website`.
3. Configure Project Settings:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** Leave empty (or default)
   - **Output Directory:** Leave empty (Vercel automatically serves `public/` and mounts `api/`)
   - **Install Command:** `npm install`
4. Expand **Environment Variables** and add the following required variables:

| Variable Name | Environment | Example Value | Description |
|---|---|---|---|
| `NODE_ENV` | Production, Preview | `production` | Enables strict security and disables development-only fallbacks. |
| `BOT_API_SECRET` | Production, Preview | `random_64_char_hex_key` | High-entropy shared secret used for HMAC-SHA256 signing with Streamer.bot. |
| `TURSO_DATABASE_URL` | Production, Preview | `libsql://acrone-collection-org.turso.io` | Turso Cloud database URL. |
| `TURSO_AUTH_TOKEN` | Production, Preview | `eyJhbGciOi...` | Turso authentication token. |
| `SITE_BASE_URL` | Production, Preview | `https://your-project.vercel.app` | Canonical domain for generated public profile links. |
| `ALLOW_SEARCH_INDEXING` | Production | `false` | Prevents search engine bots from indexing viewer profiles (optional). |

> [!CAUTION]
> The application will refuse to start in production if `BOT_API_SECRET` is missing, empty, or using the default dev secret, or if `TURSO_DATABASE_URL` is missing.

5. Click **Deploy**.

---

## 6. Step 4: Post-Deployment Verification

Once deployed, verify the deployment:

### 1. Test Bot Health Endpoint
Run in your terminal (replacing with your Vercel domain):
```bash
curl -s https://your-project.vercel.app/api/v1/bot/health
```
**Expected Response `200 OK`:**
```json
{
  "status": "healthy",
  "database": "connected",
  "apiVersion": "2.0.0",
  "timestamp": 1731671234000,
  "catalogue": {
    "fish": 60,
    "mining": 50,
    "chest": 25,
    "total": 135
  }
}
```

### 2. Test Frontend
1. Open `https://your-project.vercel.app` in your browser.
2. Verify:
   - Header shows **COLLECTION** logo.
   - Text says "companion collection viewer for Goti".
   - Watermark "made with ❤️ by acrone" is visible only on the homepage footer.
   - Explore search bar works.

### 3. Test Bot HMAC Authentication
Send an authenticated request to `POST /api/v1/bot/players/upsert`:
- An unauthenticated call must return `401 Unauthorized`.
- A valid HMAC-SHA256 signed call must return `200 OK` with the player's stable `publicPlayerId`.

---

## 7. Troubleshooting Common Errors

### `FATAL: BOT_API_SECRET is missing or using insecure default value`
- **Cause:** `BOT_API_SECRET` was not added in Vercel Project Settings > Environment Variables, or is using the development placeholder.
- **Fix:** Set a secure, random string (minimum 32 characters) in Vercel Environment Variables and redeploy.

### `FATAL: TURSO_DATABASE_URL is missing`
- **Cause:** Production environment does not have Turso credentials configured.
- **Fix:** Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel Project Settings and redeploy.

### `BEARER_DISABLED_IN_PRODUCTION (403)`
- **Cause:** A request with `Authorization: Bearer ...` was received while `NODE_ENV=production`.
- **Fix:** In production, Streamer.bot must sign requests using HMAC-SHA256 headers (`x-bot-timestamp`, `x-bot-nonce`, `x-bot-signature`). Bearer auth is intentionally disabled in production for security.

### Realtime SSE Disconnections
- **Behavior:** On Vercel Serverless Functions, streaming connections have execution timeout limits.
- **Resilience:** The client application includes an automatic reconnect handler and a background synchronization loop (`/api/public/players/:publicPlayerId/events?since=...`) that automatically reconciles missed updates across serverless instances without manual page refresh.
