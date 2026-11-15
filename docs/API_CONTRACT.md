# Acrone Collection — Complete API Contract & V2 Bot Integration Reference

**Version:** 2.0.0  
**Target Clients:** Streamer.bot (Acrone Points Desktop Bot) & Acrone Collection Web Client  
**Hosting Platform:** Vercel  
**Database:** Turso Cloud (libSQL) / SQLite WAL  

---

## 1. Authentication & Security (Protected Bot APIs)

All endpoints under `/api/v1/bot/*` (except health probe) require server-to-server authentication. Requests from unauthenticated public clients will receive `HTTP 401 Unauthorized`.

### 1.1 HMAC-SHA256 Request Authentication (Mandatory in Production)

Every bot request must carry three headers:
- `X-Bot-Timestamp`: Current UTC Unix epoch timestamp in milliseconds (e.g. `1731671234000`).
- `X-Bot-Nonce`: Random unique string or UUIDv4 (prevents replay attacks).
- `X-Bot-Signature`: Hex-encoded HMAC-SHA256 signature calculated over the canonical payload:

$$\text{Canonical String} = \text{timestamp} + \text{"."} + \text{nonce} + \text{"."} + \text{raw\_body}$$

*(For `GET` requests with no body, `raw_body` is an empty string `""`)*

$$\text{Signature} = \text{HMAC-SHA256}(\text{BOT\_API\_SECRET}, \text{Canonical String})$$

#### Security Rules:
1. **Clock Drift Limit:** Server rejects requests if $| \text{server\_time} - \text{timestamp} | > 300,000 \text{ ms}$ (5 minutes) with `401 TIMESTAMP_EXPIRED`.
2. **Replay Attack Protection:** Each `X-Bot-Nonce` is tracked in memory; repeated nonces are rejected with `401 NONCE_REPLAY_DETECTED`.
3. **Constant-Time Comparison:** Verified with constant-time equality checks to prevent timing attacks.
4. **Production Enforcement:** When `NODE_ENV=production`, `Authorization: Bearer ...` is disabled and rejected with `403 BEARER_DISABLED_IN_PRODUCTION`. Server refuses to start if `BOT_API_SECRET` is unset, empty, or default.

---

## 2. Protected Bot Endpoints

### 2.1 Bot Health Check
- **Method:** `GET`
- **Route:** `/api/v1/bot/health`
- **Description:** Verifies server status, Turso database connectivity, API version, and active catalogue counts.

#### Response `200 OK`
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

---

### 2.2 Player Upsert (Stable Identity Mapping)
- **Method:** `POST`
- **Route:** `/api/v1/bot/players/upsert`
- **Description:** Resolves or creates a player by stable YouTube Channel ID. Updates display name and avatar without changing their permanent `publicPlayerId`.

#### Request Body
```json
{
  "youtubeChannelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  "displayName": "PixelPirate",
  "avatarUrl": "https://yt3.ggpht.com/a/default-avatar.jpg"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "player": {
    "id": "e55106ef-7b70-4f51-a0c5-555bb12b6ad5",
    "publicPlayerId": "usr_7a8b9c1d2e3f",
    "displayName": "PixelPirate",
    "avatarUrl": "https://yt3.ggpht.com/a/default-avatar.jpg",
    "collectionUrl": "https://collection.acrone.gg/u/usr_7a8b9c1d2e3f",
    "isNewPlayer": false
  }
}
```

---

### 2.3 Catalogue Ingestion
- **Method:** `GET`
- **Route:** `/api/v1/bot/catalog`
- **Description:** Returns all active catalogue items with category, rarity, description, and base sale values.

#### Response `200 OK`
```json
{
  "success": true,
  "count": 135,
  "items": [
    {
      "id": "fish_golden_koi",
      "category": "fish",
      "name": "Golden Koi",
      "rarity_id": "rare",
      "description": "Auspicious shimmering carp revered across ancient waterways.",
      "image_url": "/assets/items/fish_golden_koi.svg",
      "base_sale_value": 120,
      "rarity_name": "Rare",
      "rarity_color": "#3B82F6"
    }
  ]
}
```

---

### 2.4 Catalogue Synchronization
- **Method:** `POST`
- **Route:** `/api/v1/bot/catalog/sync`
- **Description:** Synchronizes catalogue definitions. Updates or adds items without modifying or resetting existing player inventories.

#### Request Body
```json
{
  "items": [
    {
      "id": "fish_golden_koi",
      "category": "fish",
      "name": "Golden Koi",
      "rarityId": "rare",
      "baseSaleValue": 125,
      "description": "Updated lore description"
    }
  ]
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "count": 1
}
```

---

### 2.5 Player Inventory Snapshot
- **Method:** `GET`
- **Route:** `/api/v1/bot/players/snapshot?youtubeChannelId=UC_x5XG1OV2P6uZZ5FSM9Ttw`
- **Description:** Fetches complete inventory, item quantities, unique item types, and unlocked achievements for bot recovery and initial state synchronization.

#### Response `200 OK`
```json
{
  "success": true,
  "player": {
    "publicPlayerId": "usr_7a8b9c1d2e3f",
    "displayName": "PixelPirate",
    "avatarUrl": "https://yt3.ggpht.com/a/default-avatar.jpg",
    "createdAt": 1731670000000,
    "lastSeenAt": 1731671234000
  },
  "stats": {
    "totalQuantity": 45,
    "uniqueItemTypes": 18,
    "overallCompletionPercentage": 13.3,
    "categories": {
      "fish": { "discovered": 10, "total": 60, "completionPercentage": 16.7 },
      "mining": { "discovered": 6, "total": 50, "completionPercentage": 12.0 },
      "chest": { "discovered": 2, "total": 25, "completionPercentage": 8.0 }
    }
  },
  "inventory": [
    {
      "itemId": "fish_common_sardine",
      "name": "Common Sardine",
      "category": "fish",
      "rarity": "Common",
      "quantity": 3,
      "baseSaleValue": 10,
      "firstFoundAt": 1731670000000,
      "lastFoundAt": 1731671000000
    }
  ],
  "achievements": [
    {
      "id": "ach_first_catch",
      "code": "first_catch",
      "name": "First Cast",
      "category": "fish",
      "status": "unlocked",
      "unlockedAt": 1731670000000
    }
  ]
}
```

---

### 2.6 Record Collection Event (Idempotent Find / Drop)
- **Method:** `POST`
- **Route:** `/api/v1/bot/collection-events`

#### Request Body
```json
{
  "eventId": "e98e21a0-a924-42b7-84f9-b8fb217f0b90",
  "youtubeChannelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  "itemId": "fish_golden_koi",
  "quantity": 1,
  "source": "fishing",
  "referenceId": "stream_roll_10842",
  "occurredAt": 1731671234000
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "idempotentReplay": false,
  "publicPlayerId": "usr_7a8b9c1d2e3f",
  "item": {
    "id": "fish_golden_koi",
    "name": "Golden Koi",
    "category": "fish",
    "rarity": "Rare",
    "newQuantity": 3,
    "wasFirstDiscovery": false
  },
  "stats": {
    "totalQuantity": 46,
    "uniqueItemTypes": 18,
    "overallCompletionPercentage": 13.3
  }
}
```

---

### 2.7 Two-Phase Selling System

```
[Streamer.bot]                                    [Website Backend]
      │                                                   │
      │ 1. POST /api/v1/bot/sales/reserve                │
      ├──────────────────────────────────────────────────▶│ (Validates ownership,
      │                                                   │  reserves quantity for 60s)
      │◀──────────────────────────────────────────────────┤
      │   Reservation Confirmed (Sale Value Calculated)   │
      │                                                   │
      │ 2. Credits Acrone Points Locally in Streamer.bot │
      │    ┌──────────────────────────┐                   │
      │    │ Points Ledger Updated OK │                   │
      │    └──────────────────────────┘                   │
      │                                                   │
      │ 3A. POST /api/v1/bot/sales/commit (On Success)    │
      ├──────────────────────────────────────────────────▶│ (Permanently deducts item,
      │                                                   │  broadcasts realtime update)
      │◀──────────────────────────────────────────────────┤
      │                                                   │
      │ 3B. POST /api/v1/bot/sales/cancel (On Failure)    │
      ├──────────────────────────────────────────────────▶│ (Releases reserved items
      │                                                   │  back to player inventory)
      │◀──────────────────────────────────────────────────┤
```

#### Phase 1: Reserve Item
- **Method:** `POST`
- **Route:** `/api/v1/bot/sales/reserve`

```json
{
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41",
  "youtubeChannelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  "itemId": "fish_common_sardine",
  "quantity": 2
}
```

##### Response `200 OK`
```json
{
  "success": true,
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41",
  "status": "reserved",
  "itemId": "fish_common_sardine",
  "quantityReserved": 2,
  "remainingAvailable": 1,
  "suggestedSaleValueTotal": 20,
  "expiresAt": 1731671294000
}
```

##### Error Response `400 Bad Request`
```json
{
  "error": "INSUFFICIENT_QUANTITY",
  "message": "Player owns 1 (0 reserved), but requested to sell 2",
  "available": 1,
  "owned": 1
}
```

#### Phase 2A: Commit Sale
- **Method:** `POST`
- **Route:** `/api/v1/bot/sales/commit`

```json
{
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41"
}
```

##### Response `200 OK`
```json
{
  "success": true,
  "status": "committed",
  "publicPlayerId": "usr_7a8b9c1d2e3f",
  "itemId": "fish_common_sardine",
  "quantitySold": 2,
  "newQuantity": 1,
  "isStillDiscovered": true,
  "badgesRevoked": []
}
```

#### Phase 2B: Cancel Sale
- **Method:** `POST`
- **Route:** `/api/v1/bot/sales/cancel`

```json
{
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41",
  "reason": "Local bot points ledger failure"
}
```

##### Response `200 OK`
```json
{
  "success": true,
  "status": "cancelled",
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41",
  "message": "Reserved items returned to player available inventory"
}
```

---

### 2.8 Authoritative Achievement Sync
- **Method:** `POST`
- **Route:** `/api/v1/bot/achievements/sync`

```json
{
  "youtubeChannelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  "achievementId": "ach_first_catch",
  "action": "unlock"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "publicPlayerId": "usr_7a8b9c1d2e3f",
  "achievementId": "ach_first_catch",
  "status": "unlocked"
}
```

---

## 3. Public Endpoints (Zero Auth)

| Route | Method | Description |
|---|---|---|
| `/api/public/players/:publicPlayerId` | `GET` | Public profile header, stats, and 8 recent activities. |
| `/api/public/players/:publicPlayerId/collection` | `GET` | Discovered and undiscovered items with category, rarity, and status filters. |
| `/api/public/players/:publicPlayerId/achievements` | `GET` | Unlocked and locked badge progress. |
| `/api/public/players/:publicPlayerId/stream` | `GET` | Real-time Server-Sent Events (SSE). |
| `/api/public/players/:publicPlayerId/events?since=:ms` | `GET` | Event reconciliation feed for serverless reconnection. |
| `/api/public/catalog` | `GET` | All active catalogue definitions and rarity color tiers. |
| `/api/public/search?query=:q` | `GET` | Player profile search by display name or public ID. |
