# Streamer.bot / Acrone Points Desktop Integration Guide

This guide is for the developer of the **Acrone Points** desktop app / Streamer.bot integration. It provides step-by-step instructions and production-ready C# code snippets for connecting YouTube chat commands directly to the Acrone Collection website.

---

## 1. Architecture Overview

```
 [YouTube Chat] ──▶ [Streamer.bot Client] ──▶ [Acrone Collection Server]
                     - Handles Game RNG        - Authoritative inventory
                     - Points Ledger           - Real-time SSE updates
                     - Chat Replies            - Public Profile (/u/{id})
```

- **Authentication:** All requests to `/api/v1/bot/*` must carry the secret configured in `.env` as `BOT_API_SECRET`.
  - Header: `Authorization: Bearer <BOT_API_SECRET>` (or HMAC headers `X-Bot-Timestamp`, `X-Bot-Nonce`, `X-Bot-Signature`).
- **Identity Key:** Pass the viewer's YouTube Channel ID (`UC...`). The backend automatically resolves this to an opaque public slug (`usr_...`).

---

## 2. Command Implementations

### Command 1: `!collection`
Replies in YouTube chat with the viewer's personal public collection link.

#### Streamer.bot C# Action (`Execute C# Code`):
```csharp
using System;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly HttpClient client = new HttpClient();
    private const string API_ENDPOINT = "https://YOUR-ACRONE-DOMAIN.com/api/v1/bot/players/upsert";
    private const string BOT_API_SECRET = "YOUR_CONFIGURED_BOT_SECRET";

    public bool Execute()
    {
        // 1. Extract YouTube viewer variables from Streamer.bot context
        string youtubeChannelId = CPH.GetYouTubeUserChannelId(); // or CPH.GetTwitchOrYouTubeUser();
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

            var request = new HttpRequestMessage(HttpMethod.Post, API_ENDPOINT);
            request.Headers.Add("Authorization", "Bearer " + BOT_API_SECRET);
            request.Content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");

            var response = client.SendAsync(request).Result;
            string jsonResponse = response.Content.ReadAsStringAsync().Result;

            if (response.IsSuccessStatusCode)
            {
                dynamic data = JsonConvert.DeserializeObject(jsonResponse);
                string collectionUrl = data.player.collectionUrl;

                // Reply to the viewer in YouTube chat
                CPH.SendYouTubeMessage($"@{displayName} Your collection: {collectionUrl}");
                return true;
            }
            else
            {
                CPH.LogWarn($"[Acrone] Upsert failed with status: {response.StatusCode}");
                return false;
            }
        }
        catch (Exception ex)
        {
            CPH.LogError("[Acrone] Error in !collection action: " + ex.Message);
            return false;
        }
    }
}
```

---

### Command 2: `!fish`, `!mine`, `!chest` (Item Finds)
When a mini-game succeeds and awards an item, record the event on the website.

#### Streamer.bot C# Action:
```csharp
using System;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly HttpClient client = new HttpClient();
    private const string API_ENDPOINT = "https://YOUR-ACRONE-DOMAIN.com/api/v1/bot/collection-events";
    private const string BOT_API_SECRET = "YOUR_CONFIGURED_BOT_SECRET";

    public bool Execute()
    {
        string youtubeChannelId = CPH.GetYouTubeUserChannelId();
        string displayName = CPH.GetYouTubeUserDisplayName();
        
        // E.g. roll result determined by your local bot game RNG:
        string itemId = "fish_golden_koi"; 
        string source = "fishing"; // 'fishing', 'mining', or 'chest'
        string eventId = Guid.NewGuid().ToString(); // Idempotency key

        try
        {
            var payload = new
            {
                eventId = eventId,
                youtubeChannelId = youtubeChannelId,
                itemId = itemId,
                quantity = 1,
                source = source,
                occurredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            var request = new HttpRequestMessage(HttpMethod.Post, API_ENDPOINT);
            request.Headers.Add("Authorization", "Bearer " + BOT_API_SECRET);
            request.Content = new StringContent(JsonConvert.SerializeObject(payload), Encoding.UTF8, "application/json");

            var response = client.SendAsync(request).Result;
            string json = response.Content.ReadAsStringAsync().Result;

            if (response.IsSuccessStatusCode)
            {
                dynamic result = JsonConvert.DeserializeObject(json);
                string itemName = result.item.name;
                int newQty = result.item.newQuantity;

                CPH.SendYouTubeMessage($"🎣 @{displayName} caught a [{result.item.rarity}] {itemName}! (Owned: ×{newQty})");
                return true;
            }
            return false;
        }
        catch (Exception ex)
        {
            CPH.LogError("[Acrone] Event submission failed: " + ex.Message);
            return false;
        }
    }
}
```

---

### Command 3: `!sell <item> <quantity>` (Two-Phase Atomic Selling)
Selling items converts collectibles into Acrone Points. The two-phase flow prevents double-selling and prevents items disappearing if your local points ledger crashes:

```csharp
public bool ExecuteSell(string youtubeChannelId, string itemId, int quantity)
{
    string reservationId = "res_" + Guid.NewGuid().ToString();

    // PHASE 1: Reserve inventory on Acrone Collection server
    var reservePayload = new {
        reservationId = reservationId,
        youtubeChannelId = youtubeChannelId,
        itemId = itemId,
        quantity = quantity
    };
    
    var reserveRes = PostToBotApi("/api/v1/bot/sales/reserve", reservePayload);
    if (!reserveRes.success) {
        CPH.SendYouTubeMessage("❌ You do not have enough of that item to sell!");
        return false;
    }

    int pointsToCredit = reserveRes.suggestedSaleValueTotal;

    // PHASE 2: Credit Acrone Points in your local Streamer.bot database
    bool pointsCredited = LocalPointsLedger.AddPoints(youtubeChannelId, pointsToCredit);

    if (pointsCredited) {
        // Phase 2A: Commit the sale
        PostToBotApi("/api/v1/bot/sales/commit", new { reservationId });
        CPH.SendYouTubeMessage($"💰 Sold {quantity}× for {pointsToCredit} Acrone Points!");
        return true;
    } else {
        // Phase 2B: Cancel reservation if points addition failed
        PostToBotApi("/api/v1/bot/sales/cancel", new { reservationId, reason = "Local points ledger failure" });
        CPH.SendYouTubeMessage("❌ An error occurred crediting points. Your items have been restored.");
        return false;
    }
}
```

---

## 3. Offline Queuing & Idempotency Rules

1. **Deterministic Event IDs:** Every find or drop must generate a UUID `eventId` before attempting the network request.
2. **Offline Retry:** If the broadcaster's internet connection temporarily drops:
   - Save the unacknowledged event to a local SQLite table or file queue: `(eventId, youtubeChannelId, itemId, quantity, source, timestamp)`.
   - When the connection recovers, replay the events in sequence.
   - The backend checks `eventId` and ignores duplicates, guaranteeing **zero duplicate items**.
