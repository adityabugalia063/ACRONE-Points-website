# Acrone Collection — API Contract & Integration Reference

**Version:** 1.0.0  
**Target Clients:** Streamer.bot (Acrone Points Desktop Bot) & Acrone Collection Public Web Client  
**Base URL:** `https://YOUR-ACRONE-DOMAIN.com`

---

## 1. Authentication & Security (Protected Bot APIs)

All endpoints under `/api/v1/bot/*` require server-to-server authentication. Requests from public web browsers will receive `401 Unauthorized`.

### 1.1 HMAC-SHA256 Signature Verification (Recommended Production)
Every HTTP request must include three headers:
- `X-Bot-Timestamp`: Current UTC Unix epoch timestamp in milliseconds (e.g. `1731671234000`).
- `X-Bot-Nonce`: Random unique string or UUIDv4 (prevents replay attacks).
- `X-Bot-Signature`: Hex-encoded HMAC-SHA256 hash calculated as:
  $$\text{Signature} = \text{HMAC-SHA256}(\text{BOT\_API\_SECRET}, \text{timestamp} + \text{"."} + \text{nonce} + \text{"."} + \text{raw\_json\_body})$$

```
Timestamp Drift Limit: Requests with |server_time - timestamp| > 300,000 ms (5 minutes) will be rejected with HTTP 401.
```

### 1.2 Bearer Token Fallback (Development & Staging)
For quick local testing and basic bots:
```http
Authorization: Bearer <BOT_API_SECRET>
```

---

## 2. Protected Bot Endpoints

### 2.1 Player Upsert (Channel ID Mapping)
Resolves or creates a player by YouTube Channel ID and updates their display name and avatar. Use this when a player chats or before posting an event.

- **Method:** `POST`
- **Route:** `/api/v1/bot/players/upsert`
- **Headers:** `Content-Type: application/json`

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
    "publicPlayerId": "usr_7a8b9c1d2e3f",
    "displayName": "PixelPirate",
    "avatarUrl": "https://yt3.ggpht.com/a/default-avatar.jpg",
    "collectionUrl": "https://YOUR-DOMAIN/u/usr_7a8b9c1d2e3f",
    "isNewPlayer": false
  }
}
```

---

### 2.2 Record Collection Event (Idempotent Find / Drop)
Records an item discovery from Fishing, Mining, Mystery Chest, or administrative grant.

- **Method:** `POST`
- **Route:** `/api/v1/bot/collection-events`
- **Headers:** `Content-Type: application/json`

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

| Field | Type | Description |
|---|---|---|
| `eventId` | string (UUID) | Unique idempotency key. Repeating with same ID returns cached response. |
| `youtubeChannelId` | string | Player's YouTube Channel ID. |
| `itemId` | string | Valid ID from `catalog_items`. |
| `quantity` | integer | Positive integer to add (typically `1`). |
| `source` | string | `'fishing'`, `'mining'`, `'chest'`, or `'admin'`. |
| `referenceId` | string (optional) | Bot transaction / roll ID for audit logs. |
| `occurredAt` | integer (optional)| Unix epoch ms when event happened. |

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
    "rarity": "legendary",
    "newQuantity": 3,
    "wasFirstDiscovery": false
  },
  "stats": {
    "uniqueOwned": 42,
    "totalQuantity": 158,
    "categoryDiscovered": 18,
    "categoryTotal": 60,
    "completionPercentage": 31.1
  }
}
```

---

### 2.3 Two-Phase Sale Flow (Reserve -> Commit / Cancel)

To ensure that item selling in YouTube chat is 100% idempotent and points cannot be credited without inventory being removed (or vice versa):

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

#### Response `200 OK` (Reservation successful)
```json
{
  "success": true,
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41",
  "status": "reserved",
  "itemId": "fish_common_sardine",
  "quantityReserved": 2,
  "remainingAvailable": 3,
  "suggestedSaleValueTotal": 50,
  "expiresAt": 1731671294000
}
```

#### Response `400 Bad Request` (Insufficient items)
```json
{
  "success": false,
  "error": "INSUFFICIENT_QUANTITY",
  "message": "Player owns 1, but requested to reserve 2"
}
```

#### Phase 2A: Commit Sale (After bot successfully credits Acrone Points)
- **Method:** `POST`
- **Route:** `/api/v1/bot/sales/commit`

```json
{
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "status": "committed",
  "publicPlayerId": "usr_7a8b9c1d2e3f",
  "itemId": "fish_common_sardine",
  "quantitySold": 2,
  "newQuantity": 3,
  "isStillDiscovered": true,
  "badgesRevoked": []
}
```

*Note on Final Copy Sold:* If `newQuantity` drops to `0`, `isStillDiscovered` returns `false`, and `badgesRevoked` will list any collection badges that required active ownership.

#### Phase 2B: Cancel Sale (If bot points crediting encounters local error)
- **Method:** `POST`
- **Route:** `/api/v1/bot/sales/cancel`

```json
{
  "reservationId": "res_84d7a123-55b2-4d91-8d2b-1029cfa90b41",
  "reason": "Local bot points ledger failed"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "status": "cancelled",
  "message": "Reserved items returned to player available inventory"
}
```

---

### 2.4 Authoritative Achievement Sync
- **Method:** `POST`
- **Route:** `/api/v1/bot/achievements/sync`

```json
{
  "youtubeChannelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
  "achievementId": "ach_angler_novice",
  "action": "unlock" // or "revoke"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "publicPlayerId": "usr_7a8b9c1d2e3f",
  "achievementId": "ach_angler_novice",
  "status": "unlocked"
}
```

---

## 3. Public Read Endpoints (Zero Login)

### 3.1 Public Player Profile & Overview
- **Method:** `GET`
- **Route:** `/api/public/players/:publicPlayerId`

#### Response `200 OK`
```json
{
  "player": {
    "publicPlayerId": "usr_7a8b9c1d2e3f",
    "displayName": "PixelPirate",
    "avatarUrl": "https://yt3.ggpht.com/a/default-avatar.jpg",
    "titleBadge": "Master Angler",
    "lastSeenAt": 1731671234000
  },
  "stats": {
    "totalQuantity": 158,
    "uniqueItemTypes": 42,
    "overallCompletionPercentage": 31.1,
    "categories": {
      "fish": {
        "discovered": 18,
        "total": 60,
        "completionPercentage": 30.0
      },
      "mining": {
        "discovered": 16,
        "total": 50,
        "completionPercentage": 32.0
      },
      "chest": {
        "discovered": 8,
        "total": 25,
        "completionPercentage": 32.0
      }
    }
  },
  "recentActivity": [
    {
      "eventType": "found",
      "itemName": "Golden Koi",
      "category": "fish",
      "rarity": "legendary",
      "rarityColor": "#FFB800",
      "occurredAt": 1731671234000
    }
  ]
}
```

### 3.2 Category Collection (Discovered & Undiscovered)
- **Method:** `GET`
- **Route:** `/api/public/players/:publicPlayerId/collection?category=fish`
- **Query Parameters:**
  - `category` (required): `'all'`, `'fish'`, `'mining'`, or `'chest'`
  - `rarity` (optional): `'common'`, `'rare'`, etc.
  - `status` (optional): `'discovered'` or `'undiscovered'`
  - `sort` (optional): `'rarity'`, `'quantity'`, `'name'`

#### Response `200 OK`
```json
{
  "category": "fish",
  "summary": {
    "discovered": 18,
    "total": 60,
    "completionPercentage": 30.0
  },
  "items": [
    {
      "id": "fish_golden_koi",
      "name": "Golden Koi",
      "category": "fish",
      "rarityId": "legendary",
      "rarityName": "Legendary",
      "rarityColor": "#FFB800",
      "description": "A radiant shimmering carp revered across ancient waterways.",
      "imageUrl": "/assets/items/fish_golden_koi.svg",
      "quantity": 3,
      "isDiscovered": true,
      "firstFoundAt": 1731000000000,
      "lastFoundAt": 1731671234000
    },
    {
      "id": "fish_void_angler",
      "name": "Void Angler",
      "category": "fish",
      "rarityId": "mythic",
      "rarityName": "Mythic",
      "rarityColor": "#A855F7",
      "description": "A creature lurking in the abyss that absorbs light.",
      "imageUrl": "/assets/items/fish_void_angler.svg",
      "quantity": 0,
      "isDiscovered": false,
      "firstFoundAt": null,
      "lastFoundAt": null
    }
  ]
}
```

### 3.3 Public Achievements
- **Method:** `GET`
- **Route:** `/api/public/players/:publicPlayerId/achievements`

#### Response `200 OK`
```json
{
  "unlockedCount": 5,
  "totalCount": 12,
  "achievements": [
    {
      "id": "ach_fish_10",
      "name": "Novice Angler",
      "description": "Catch 10 unique fish species.",
      "category": "fish",
      "badgeIcon": "/assets/badges/novice_angler.svg",
      "isUnlocked": true,
      "unlockedAt": 1731500000000
    }
  ]
}
```

### 3.4 Real-Time Server-Sent Events (SSE)
- **Method:** `GET`
- **Route:** `/api/public/players/:publicPlayerId/stream`
- **Headers:** `Accept: text/event-stream`

#### Event Stream Example
```
event: connected
data: {"message":"Subscribed to real-time updates for usr_7a8b9c1d2e3f"}

event: inventory_updated
data: {"type":"inventory_updated","itemId":"fish_golden_koi","itemName":"Golden Koi","category":"fish","delta":1,"newQuantity":3,"isDiscovered":true,"timestamp":1731671234000}

event: stats_updated
data: {"uniqueItemTypes":42,"totalQuantity":158,"overallCompletionPercentage":31.1}

:heartbeat (every 25s)
```

---

## 4. Streamer.bot Integration Guide (C# Code Example)

The desktop bot developer can paste this standard C# method into Streamer.bot (`Execute C# Code` action) to respond to `!collection`:

```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

public class CPHInline
{
    private static readonly HttpClient client = new HttpClient();
    private const string API_URL = "https://YOUR-ACRONE-DOMAIN.com/api/v1/bot/players/upsert";
    private const string BOT_API_SECRET = "acrone_super_secure_bot_secret_xyz123";

    public bool Execute()
    {
        // 1. Extract YouTube viewer variables from Streamer.bot context
        string youtubeChannelId = CPH.GetTwitchOrYouTubeUser(); // or CPH.GetYouTubeChannelId()
        string displayName = CPH.GetYouTubeUserDisplayName();
        string avatarUrl = CPH.GetYouTubeUserAvatar();

        try
        {
            var payload = new
            {
                youtubeChannelId = youtubeChannelId,
                displayName = displayName,
                avatarUrl = avatarUrl
            };

            string json = Newtonsoft.Json.JsonConvert.SerializeObject(payload);
            var request = new HttpRequestMessage(HttpMethod.Post, API_URL);
            request.Headers.Add("Authorization", "Bearer " + BOT_API_SECRET);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = client.SendAsync(request).Result;
            string responseString = response.Content.ReadAsStringAsync().Result;

            dynamic data = Newtonsoft.Json.JsonConvert.DeserializeObject(responseString);
            string collectionUrl = data.player.collectionUrl;

            // 2. Reply to viewer in YouTube chat
            CPH.SendYouTubeMessage($"@{displayName} Your collection: {collectionUrl}");
            return true;
        }
        catch (Exception ex)
        {
            CPH.LogWarn("Acrone Collection Error: " + ex.Message);
            CPH.SendYouTubeMessage($"@{displayName} Could not load collection right now. Please try again later!");
            return false;
        }
    }
}
```
