# Collection — Public Companion to Goti

[![Tests](https://img.shields.io/badge/tests-36%2F36%20passing-brightgreen)](#automated-testing)
[![Node](https://img.shields.io/badge/node-v20%2B%20%7C%20v22%2B-blue)](https://nodejs.org)
[![Hosting](https://img.shields.io/badge/hosting-Vercel-black)](VERCEL_DEPLOYMENT.md)
[![Database](https://img.shields.io/badge/database-Turso%20Cloud%20%2F%20libSQL-00E599)](#database-architecture)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Collection** is the public-facing read-only companion website for the **Goti** YouTube Streamer.bot gaming system. Viewers play chat mini-games (**Fishing**, **Mining**, and **Mystery Chests**) during livestreams, and their public collections are viewable by anyone with their link without requiring sign-up or login.

---

## 🌟 Key Features

- **Zero-Login Public Profiles:** Open any player link directly (`/u/{publicPlayerId}`). No login wall, no OAuth, no account creation.
- **Privacy-First Architecture:** Private YouTube Channel IDs (`UC...`) and points balances are **never** exposed publicly. Public URLs use collision-resistant opaque slugs (`usr_...`).
- **Instant Real-Time Synchronization:** Uses Server-Sent Events (SSE) with dual-layer cloud event reconciliation for seamless multi-instance Vercel Serverless Function updates.
- **Strictly Read-Only Web Surface:** Zero buttons or forms to sell, trade, or mutate items on the website. Item selling is performed exclusively through chat commands handled by Streamer.bot.
- **Two-Phase Idempotent Selling Flow:** Safe `reserve` & `commit`/`cancel` transaction protocol prevents double-selling and protects against item loss during bot crashes.
- **Dynamic Data-Driven Denominators:** Total item counts and category progress are calculated live from the database, never hard-coded.
- **Separate Unique vs. Quantity Tracking:** 15 Common Sardines count as **1 unique type** and **15 total quantity**.
- **Dynamic Badge Revocation:** If a player sells their final copy of an item and drops below an achievement threshold, the badge is automatically revoked.
- **Signature & Nonce Verification:** Production-grade HMAC-SHA256 verification with replay prevention and clock drift checking for all bot calls.
- **Dark Gaming Aesthetic:** Deep Black (`#09090C`), Crimson Accent (`#D83C53`), elevated card surfaces (`#19191F`), responsive across mobile and desktop.
- **Watermark:** Proudly displaying `made with ❤️ by acrone` on the homepage footer.
- **Vercel & Turso Cloud Ready:** Fully native libSQL / Turso Cloud deployment support with zero-downtime database migrations.

---

## 🏗️ System Architecture

```
  YOUTUBE STREAM CHAT
  (Viewers type: !fish, !mine, !chest, !collection, !sell)
             │
             ▼
  STREAMER.BOT / GOTI BOT CLIENT
  - Evaluates chat game RNG & currency ledger
  - Signs requests with HMAC-SHA256 (Bot Secret)
  - Replies in YouTube chat: "@{user} Your collection: https://your-acrone-project.vercel.app/u/{publicPlayerId}"
             │
             ▼ (Protected HTTPS POST with HMAC headers)
  COLLECTION SERVER (Vercel Serverless / Node.js)
  ├─ [Bot Auth Middleware] HMAC-SHA256 & Nonce Replay Check
  ├─ [Inventory Mutation Engine] Idempotent Find & 2-Phase Sale
  ├─ [Authoritative Achievement Engine] Dynamic Award & Revocation
  ├─ [Durable Storage] Turso Cloud (libSQL) / Local SQLite WAL
  └─ [Real-time Hub] Server-Sent Events (SSE) & Catch-Up Stream
             │
             ▼ (Public Read-Only HTTPS & SSE)
  PUBLIC WEB CLIENT (Desktop & Mobile)
  ├─ Profile Route: /u/{publicPlayerId}
  ├─ Categorized Tabs: Overview, Fish, Mining, Chests, Achievements
  └─ Discovered Cards, Undiscovered Silhouettes, Search & Filters
```

Detailed documentation:
- 🚀 [Vercel & Turso Deployment Guide](VERCEL_DEPLOYMENT.md)
- 📖 [Architecture Specification](docs/ARCHITECTURE.md)
- 🔌 [Complete V2 API Contract Reference](docs/API_CONTRACT.md)
- 🤖 [Streamer.bot Integration Guide (with C# Code)](docs/STREAMERBOT_INTEGRATION.md)
- 📋 [Outstanding Owner Decisions Checklist](docs/OWNER_DECISIONS.md)

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js v22.0.0 or higher (v26 recommended)

### 1. Clone & Configure Environment
```bash
git clone https://github.com/acrone/acrone-collection.git
cd acrone-collection

# Copy example environment configuration
cp .env.example .env
```

### 2. Seed Database & Assets
Seeds the database with 6 rarity tiers, 60 fish, 50 minerals, 25 chest items, 10 achievements, and sample players, and generates procedural SVG assets:
```bash
# Seed database
node server/db/seed.js

# Generate vector SVG assets
node scripts/generateAssets.js
```

### 3. Start the Server
```bash
node server/index.js
```
The server will start at `http://localhost:3000`.

### 4. Open in Browser
- **Homepage & Lookup:** [http://localhost:3000/](http://localhost:3000/)
- **Sample Profile (PixelPirate):** [http://localhost:3000/u/usr_pixelpirate](http://localhost:3000/u/usr_pixelpirate)
- **Fish Collection:** [http://localhost:3000/u/usr_pixelpirate/fish](http://localhost:3000/u/usr_pixelpirate/fish)
- **Mining Collection:** [http://localhost:3000/u/usr_pixelpirate/mining](http://localhost:3000/u/usr_pixelpirate/mining)
- **Mystery Chest Finds:** [http://localhost:3000/u/usr_pixelpirate/chest](http://localhost:3000/u/usr_pixelpirate/chest)
- **Achievements:** [http://localhost:3000/u/usr_pixelpirate/achievements](http://localhost:3000/u/usr_pixelpirate/achievements)

---

## 🧪 Automated Testing

Run the automated test suite covering authentication, idempotency, metrics calculation, two-phase sales, badge revocation, and privacy audits:

```bash
npm test
```

### Test Coverage Highlights:
- **Authentication:** Valid Bearer tokens, HMAC-SHA256 signatures, forged signature rejection, clock drift limit (>5 mins), and nonce replay protection.
- **Inventory & Idempotency:** Duplicate submission of the same event ID returns cached response without incrementing inventory twice.
- **Metric Distinction:** 5 copies of 1 fish are verified as 1 unique type and 5 total quantity.
- **Two-Phase Sale:** Tests reservation locking, oversell prevention (`INSUFFICIENT_QUANTITY`), commit deduction, and cancellation rollbacks.
- **Final Copy Sold:** Tests that selling the last copy marks the item as undiscovered, recalculates progress, and revokes earned badges.
- **Privacy Audit:** Verifies that public endpoints never leak private YouTube Channel IDs, bot API secrets, or points balances.

---

## 🤖 Simulating Bot Activity

To test real-time instant synchronization without setting up Streamer.bot:

1. Open `http://localhost:3000/u/usr_pixelpirate` in your browser.
2. In a terminal, run:
```bash
node scripts/simulateBotActivity.js
```
You will observe:
- Immediate floating toast notifications on the web page.
- Item quantities and category progress bars animating live without refreshing the browser.

---

## 🚢 Production Deployment Guide

### Option 1: Systemd Service (Linux VPS / Ubuntu)
```ini
[Unit]
Description=Acrone Collection Server
After=network.target

[Service]
Type=simple
User=acrone
WorkingDirectory=/var/www/acrone-collection
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### Option 2: Docker Container
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN node server/db/seed.js && node scripts/generateAssets.js
EXPOSE 3000
CMD ["node", "server/index.js"]
```

### Option 3: Cloud Platforms (Railway, Render, Fly.io)
1. Link your Git repository.
2. Set Environment Variables from `.env.example`.
3. Set Start Command: `node server/index.js`.
4. Ensure persistent disk volume mounted at `/app/server/data` to persist SQLite data across deployments.

---

## 📁 Repository Directory Structure

```
├── docs/
│   ├── ARCHITECTURE.md           # System architecture, schemas, and security model
│   ├── API_CONTRACT.md           # Complete API contract and schema reference
│   ├── STREAMERBOT_INTEGRATION.md# Step-by-step Streamer.bot C# integration guide
│   └── OWNER_DECISIONS.md        # List of remaining owner choices & configuration
├── public/
│   ├── assets/
│   │   ├── badges/               # Achievement vector SVGs
│   │   └── items/                # Collectible vector SVGs (Fish, Mining, Chest)
│   ├── css/
│   │   └── app.css               # Gaming design tokens, dark theme, responsive grid
│   ├── js/
│   │   └── app.js                # Vanilla SPA router & SSE real-time client
│   └── index.html                # Main entry point with Open Graph meta tags
├── scripts/
│   ├── generateAssets.js         # Procedural SVG icon generator
│   └── simulateBotActivity.js    # Bot simulator for testing real-time events
├── server/
│   ├── config.js                 # Environment configuration loader
│   ├── index.js                  # HTTP server & static file dispatcher
│   ├── router.js                 # URL & route parameter matching engine
│   ├── db/
│   │   ├── index.js              # SQLite connection (WAL, foreign keys, busy timeout)
│   │   └── seed.js               # Seed script with 135 collectibles & sample players
│   ├── middleware/
│   │   └── auth.js               # HMAC-SHA256 signature & Bearer validator
│   ├── routes/
│   │   ├── botRoutes.js          # Protected server-to-server endpoints
│   │   └── publicRoutes.js       # Unauthenticated public read & SSE endpoints
│   └── services/
│       ├── achievementService.js # Authoritative badge unlock & revocation logic
│       ├── inventoryService.js   # Idempotent find ledger & 2-phase sale engine
│       ├── playerService.js      # Stable player identity & stats calculations
│       └── sseService.js         # Server-Sent Events hub & broadcaster
├── test/
│   ├── testHelper.js             # Dispatcher and HMAC generation helpers
│   ├── auth.test.js              # Authentication security test suite
│   ├── inventory.test.js         # Inventory, idempotency, and sale test suite
│   └── publicApi.test.js         # Public API and privacy test suite
├── .env.example                  # Environment configuration template
├── .gitignore                    # Git ignore file
└── package.json                  # Project manifest and scripts
```

---

## 📜 License

MIT License. Designed and built for the **Acrone Points** community.
