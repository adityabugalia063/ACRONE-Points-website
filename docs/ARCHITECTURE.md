# Acrone Collection — Architecture Specification

## 1. Executive Summary & Purpose
**Acrone Collection** is the public read-only companion website for the **Acrone Points** YouTube streaming gamification system (powered by Streamer.bot). Viewers play interactive chat games (*Fishing*, *Mining*, *Mystery Chests*) to discover and accumulate collectible items.

This system decouples public collection viewing from private game economy management:
- **Streamer.bot / Acrone Points desktop bot**: Trusted authority. Handles YouTube chat commands, game RNG, points ledger, currency balances, item selling, and chat feedback.
- **Acrone Collection Backend**: Authoritative database for players, catalogue items, inventory ownership, event ledger, and achievement state. Exposes authenticated bot endpoints and unauthenticated public read endpoints.
- **Acrone Collection Frontend**: Read-only, zero-login public inventory explorer matching Acrone's dark red-and-black gaming aesthetic. Connects to real-time updates via Server-Sent Events (SSE).

---

## 2. System Architecture Diagram

```
 +-------------------------------------------------------------------------+
 |                         YOUTUBE STREAM CHAT                             |
 |           Viewers type: !fish, !mine, !chest, !collection, !sell        |
 +------------------------------------+------------------------------------+
                                      |
                                      v
 +------------------------------------+------------------------------------+
 |           STREAMER.BOT / ACRONE POINTS DESKTOP CLIENT                  |
 |  - Evaluates chat games & points balance                                |
 |  - Signs requests with HMAC-SHA256 (Bot API Secret)                    |
 |  - Local event retry queue with exponential backoff                     |
 +------------------+------------------------------------+-----------------+
                    |                                    |
     Protected HTTPS POST requests       Command "!collection" replies:
     (Upsert, Events, Sales, Badges)     "@{user} Your collection:
                    |                     https://acrone.gg/u/{publicPlayerId}"
                    v                                    |
 +------------------+------------------------------------+-----------------+
 |                    ACRONE COLLECTION SERVER (Node.js)                   |
 |                                                                         |
 |  [Bot Auth & Security]                                                  |
 |    - HMAC-SHA256 signature verification / Bearer Secret                |
 |    - Timestamp drift check (+/- 300s) & Nonce replay protection         |
 |    - Idempotency key validator                                          |
 |                                                                         |
 |  [Business Logic & State Engines]                                       |
 |    - Inventory Mutation Engine (Atomic find, sell, adjust)              |
 |    - Two-Phase Sale Reservation Engine (Reserve -> Commit / Cancel)     |
 |    - Authoritative Achievement Evaluator & Revocation Engine            |
 |                                                                         |
 |  [Durable Storage - SQLite / WAL Mode]                                  |
 |    - players, catalog_items, rarities, player_inventory                 |
 |    - collection_events, sales_reservations, player_achievements         |
 |                                                                         |
 |  [Real-Time Engine]                                                     |
 |    - SSE Connection Hub (Server-Sent Events)                            |
 |    - Dispatches instant diffs to active viewer channels                 |
 +------------------+------------------------------------------------------+
                    |
      Public HTTP / SSE (/api/public/...)
                    |
                    v
 +------------------+------------------------------------------------------+
 |                    PUBLIC WEB FRONTEND (SPA / Static)                   |
 |  - Dark Red-and-Black Competitive Gaming Aesthetic                      |
 |  - Zero Login / Zero Public Mutation Buttons                            |
 |  - Profile Route: /u/{publicPlayerId}                                   |
 |  - Dynamic Realtime Sync via EventSource (Auto-reconnect)               |
 |  - Categorized Tabs: Overview, Fish, Mining, Chest, Achievements        |
 |  - Search, Rarity Filtering, Discovered Silhouettes, Responsive UI      |
 +-------------------------------------------------------------------------+
```

---

## 3. Core Boundaries & Security Model

### 3.1 Public Privacy Protection
1. **No Points Data**: The public website and public API never receive, store, or return Acrone Points balances, currency transactions, or points leaderboards.
2. **Stable Identity Anonymization**: The private YouTube Channel ID (`UCxxxxxxxxxxxxxxxxxxxxxx`) is the backend unique key for player persistence. It is **never** returned over public APIs. Public URLs use a collision-resistant opaque ID:
   - Format: `usr_[12 hex chars]` (e.g. `usr_9a4f2b18c0de`) or clean alphanumeric slug.
3. **No Viewer Authentication**: There is no login, register, OAuth, session cookie, or password system. Collection profiles are open to anyone who has the link.
4. **Read-Only Web Client**: The public client has zero mutation APIs. It cannot add, edit, transfer, or sell items.

### 3.2 Trusted Server-to-Server Bot Authentication
- **Transport**: HTTPS mandatory in production.
- **Authentication**: Requests from Streamer.bot must include:
  1. `X-Bot-Timestamp`: Unix epoch milliseconds.
  2. `X-Bot-Nonce`: Random string (UUIDv4).
  3. `X-Bot-Signature`: `HMAC-SHA256(secret, timestamp + "." + nonce + "." + request_body)`.
  4. Alternatively in local dev: `Authorization: Bearer <BOT_API_SECRET>`.
- **Clock Drift**: Requests with timestamp drift > 5 minutes are rejected.
- **Idempotency Guarantee**: Every event payload includes `eventId`. If an event with the same ID has already been processed, the server returns the cached result (`200 OK`) without repeating the inventory mutation.

---

## 4. Relational Database Schema Proposal

Built on SQLite with Write-Ahead Logging (`WAL` mode) and Foreign Key constraints enabled.

### 4.1 Schema Definition

```sql
-- 1. Players Table
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,                       -- Internal UUID
  youtube_channel_id TEXT NOT NULL UNIQUE,   -- Stable identity key (never exposed publicly)
  public_player_id TEXT NOT NULL UNIQUE,     -- Opaque public slug (e.g., usr_9a4f2b18c0de)
  display_name TEXT NOT NULL,                -- Synced YouTube username
  avatar_url TEXT,                           -- Channel avatar thumbnail
  created_at INTEGER NOT NULL,               -- Unix epoch ms
  updated_at INTEGER NOT NULL,               -- Unix epoch ms
  last_seen_at INTEGER NOT NULL              -- Unix epoch ms
);

CREATE INDEX IF NOT EXISTS idx_players_public_id ON players(public_player_id);
CREATE INDEX IF NOT EXISTS idx_players_youtube_id ON players(youtube_channel_id);

-- 2. Rarities Table (Configurable Tiers)
CREATE TABLE IF NOT EXISTS rarities (
  id TEXT PRIMARY KEY,                       -- e.g. 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'
  name TEXT NOT NULL,                        -- e.g. 'Legendary'
  display_color TEXT NOT NULL,               -- Hex code e.g. '#FFB800'
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- 3. Catalog Items Table
CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,                       -- Unique item ID e.g. 'fish_golden_koi'
  category TEXT NOT NULL CHECK(category IN ('fish', 'mining', 'chest')),
  name TEXT NOT NULL,                        -- Item display name
  rarity_id TEXT NOT NULL REFERENCES rarities(id),
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',        -- Relative asset path or CDN URL
  active INTEGER NOT NULL DEFAULT 1,         -- If 0, excluded from collection denominator
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',           -- Flexible metadata (catch zone, biome, etc.)
  base_sale_value INTEGER DEFAULT 0          -- Bot reference sale value (not exposed to public UI)
);

CREATE INDEX IF NOT EXISTS idx_catalog_category ON catalog_items(category, active);

-- 4. Player Inventory Table
CREATE TABLE IF NOT EXISTS player_inventory (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  first_found_at INTEGER NOT NULL,
  last_found_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_player ON player_inventory(player_id);

-- 5. Collection Events Ledger (Idempotent Event Log)
CREATE TABLE IF NOT EXISTS collection_events (
  id TEXT PRIMARY KEY,                       -- Idempotency key (UUID from bot)
  player_id TEXT NOT NULL REFERENCES players(id),
  item_id TEXT NOT NULL REFERENCES catalog_items(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('found', 'sold', 'adjusted', 'chest_drop')),
  quantity_delta INTEGER NOT NULL,           -- Positive for found, negative for sold
  source TEXT NOT NULL CHECK(source IN ('fishing', 'mining', 'chest', 'admin', 'sale')),
  reference_id TEXT,                         -- Optional bot transaction / roll ID
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_player ON collection_events(player_id, occurred_at DESC);

-- 6. Sales Reservations Table (Two-Phase Commit Safety)
CREATE TABLE IF NOT EXISTS sales_reservations (
  id TEXT PRIMARY KEY,                       -- Reservation ID (UUID)
  player_id TEXT NOT NULL REFERENCES players(id),
  item_id TEXT NOT NULL REFERENCES catalog_items(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL CHECK(status IN ('reserved', 'committed', 'cancelled', 'expired')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 7. Achievements Definitions
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,                       -- e.g. 'fish_master_1'
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('all', 'fish', 'mining', 'chest', 'special')),
  badge_icon TEXT NOT NULL DEFAULT '',
  requirement_type TEXT NOT NULL,            -- 'unique_count', 'total_count', 'specific_item'
  requirement_value INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 8. Player Achievements State (Authoritative Backend State)
CREATE TABLE IF NOT EXISTS player_achievements (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('unlocked', 'revoked')),
  unlocked_at INTEGER NOT NULL,
  revoked_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, achievement_id)
);
```

---

## 5. Metrics & Calculation Specification

### 5.1 Unique Item Count vs Total Quantity
- **Unique Item Types Owned**:
  $$\text{UniqueCount} = \sum [q_i > 0 \land \text{active}_i = 1]$$
- **Total Quantity Owned**:
  $$\text{TotalQuantity} = \sum q_i$$
- **Example**: Owning 12 Common Sardines and 1 Mythic Megalodon equals **2 unique items** and **13 total items**.

### 5.2 Dynamic Denominators
- Fish Catalogue Denominator = Count of active `catalog_items` where `category = 'fish'`.
- Mining Catalogue Denominator = Count of active `catalog_items` where `category = 'mining'`.
- Mystery Chest Denominator = Count of active `catalog_items` where `category = 'chest'`.
- Overall Collection Completion =
  $$\frac{\text{Unique Fish} + \text{Unique Mining} + \text{Unique Chest}}{\text{Active Fish Total} + \text{Active Mining Total} + \text{Active Chest Total}} \times 100\%$$

### 5.3 Selling & Revocation Rule
1. When a player sells an item in chat, the bot decrements the quantity.
2. If the quantity drops from 1 to 0:
   - The item state changes from **Discovered** to **Undiscovered** in the live inventory view.
   - The category discovery count decreases by 1.
   - The overall completion percentage decreases accordingly.
   - If an achievement required owning that item or required an active unique count threshold (e.g. "Own all 60 fish"), the backend automatically evaluates the requirement and transitions the achievement state to `revoked`.

---

## 6. Two-Phase Sale Architecture (Reserve -> Commit / Cancel)

To ensure that bot points crediting and cloud inventory updates never desynchronize:

```
  Streamer.bot                                       Acrone Collection Server
       |                                                         |
       |  1. POST /api/v1/bot/sales/reserve                      |
       |     { playerId, itemId, quantity: 1 }                   |
       |-------------------------------------------------------->|
       |                                                         | Deduct available quantity
       |                                                         | Create reservation record
       |  2. 200 OK { reservationId, expiresAt }                 |
       |<--------------------------------------------------------|
       |                                                         |
       |  [Bot credits points in local database]                 |
       |                                                         |
       |  3a. Success: POST /api/v1/bot/sales/commit             |
       |      { reservationId }                                  |
       |-------------------------------------------------------->| Finalize deduction,
       |                                                         | record collection_event ('sold'),
       |  4a. 200 OK { status: 'committed' }                     | broadcast real-time SSE
       |<--------------------------------------------------------|
       |                                                         |
       |  -- OR in case of local bot error / crash --            |
       |                                                         |
       |  3b. Failure: POST /api/v1/bot/sales/cancel             |
       |      { reservationId }                                  |
       |-------------------------------------------------------->| Revert reserved quantity,
       |  4b. 200 OK { status: 'cancelled' }                     | status = 'cancelled'
       |<--------------------------------------------------------|
```
*Note: Any reservation not committed or cancelled within 60 seconds automatically expires, returning reserved items to the player's available inventory.*

---

## 7. Real-Time Instant Synchronization Specification

1. **Protocol**: Server-Sent Events (`text/event-stream`) at `GET /api/public/players/:publicPlayerId/stream`.
2. **Channel Multiplexing**: Clients register an open HTTP connection matching their profile's `publicPlayerId`.
3. **Event Messages**:
   - `inventory_updated`: Dispatched immediately when finds or sales occur. Includes category, delta, new count, new discovery status.
   - `achievement_unlocked`: Dispatched when a badge is awarded.
   - `achievement_revoked`: Dispatched if a badge is revoked due to item sale.
   - `heartbeat`: Sent every 25 seconds to keep intermediary proxies alive.
4. **Client Reconnection Strategy**:
   - Browser `EventSource` automatically reconnects on dropped network.
   - Upon reconnection, the client executes a background re-validation fetch to guarantee no events were missed during disconnection.

---

## 8. Technology Stack Selection

- **Backend Runtime**: Node.js v22+ (running on Node v26)
- **Database Engine**: `node:sqlite` (built-in synchronous SQLite with zero native build dependencies, WAL mode, ACID transactions)
- **API Framework**: Express.js with CORS, Helmet, compression, and typed route schemas
- **Frontend Framework**: React 18 / Vite with TailwindCSS and custom gaming design tokens
- **Realtime**: Native HTTP Server-Sent Events (SSE) with connection pool manager
- **Testing Suite**: Node.js Native Test Runner (`node:test`, `node:assert`) with mock bot client and integration tests
- **Packaging & Deployment**: Single-port Node.js server serving production Vite bundle and API endpoints simultaneously, ready for Docker, Railway, Render, or VPS.
