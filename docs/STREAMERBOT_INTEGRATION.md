# Streamer.bot / Acrone Points V2 Integration Guide

This guide is for the developer of the **Acrone Points V2** desktop application / Streamer.bot integration. It provides production-ready C# code snippets with **HMAC-SHA256 request signing** for connecting YouTube stream chat mini-games to the Acrone Collection website.

---

## 1. Architecture Overview

```
[YouTube Chat] ──▶ [Streamer.bot (C#)] ──▶ [Acrone Collection (Vercel)]
                     - Mini-game RNG         - Authoritative inventory
                     - Points ledger         - Real-time SSE updates
                     - Chat replies          - Public Profile (/u/{id})
```

- **Authentication:** In production, every request must carry HMAC-SHA256 headers: `X-Bot-Timestamp`, `X-Bot-Nonce`, and `X-Bot-Signature`.
- **Identity Key:** The viewer's permanent YouTube Channel ID (`UC...`). The website maps this to a stable public slug (`usr_...`).
- **Selling Flow:** Two-phase transactions: Reserve -> Credit Points locally -> Commit (or Cancel if crediting fails).

---

## 2. Shared C# HMAC Signing Helper

Include this helper method in your Streamer.bot C# script or global methods:

```csharp
using System;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;

public static class AcroneApiHelper
{
    public static HttpRequestMessage CreateSignedRequest(
        HttpMethod method,
        string url,
        string jsonBody,
        string botSecret)
    {
        var request = new HttpRequestMessage(method, url);
        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string nonce = Guid.NewGuid().ToString("N");
        string rawBody = jsonBody ?? "";

        // Canonical string: timestamp.nonce.rawBody
        string canonical = $"{timestamp}.{nonce}.{rawBody}";

        // Compute HMAC-SHA256
        string signature;
        using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(botSecret)))
        {
            byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical));
            signature = BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        }

        request.Headers.Add("X-Bot-Timestamp", timestamp.ToString());
        request.Headers.Add("X-Bot-Nonce", nonce);
        request.Headers.Add("X-Bot-Signature", signature);

        if (!string.IsNullOrEmpty(jsonBody))
        {
            request.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        }

        return request;
    }
}
```

---

## 3. Command Implementations

### Command 1: `!collection`
Replies in YouTube chat with the viewer's personal public collection link.

```csharp
using System;
using System.Net.Http;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly HttpClient client = new HttpClient();
    private const string API_URL = "https://your-acrone-project.vercel.app/api/v1/bot/players/upsert";
    private const string BOT_SECRET = "your_production_bot_secret_here";

    public bool Execute()
    {
        string channelId = CPH.GetYouTubeUserChannelId();
        string displayName = CPH.GetYouTubeUserDisplayName();
        string avatarUrl = CPH.GetYouTubeUserAvatar();

        try
        {
            var payload = new
            {
                youtubeChannelId = channelId,
                displayName = displayName,
                avatarUrl = avatarUrl
            };
            string json = JsonConvert.SerializeObject(payload);

            var request = AcroneApiHelper.CreateSignedRequest(HttpMethod.Post, API_URL, json, BOT_SECRET);
            var response = client.SendAsync(request).Result;
            string body = response.Content.ReadAsStringAsync().Result;

            if (response.IsSuccessStatusCode)
            {
                dynamic result = JsonConvert.DeserializeObject(body);
                string collectionUrl = result.player.collectionUrl;
                CPH.SendYouTubeMessage($"@{displayName} Your collection: {collectionUrl}");
                return true;
            }
            else
            {
                CPH.LogWarn("[Acrone] Upsert failed: " + response.StatusCode);
                return false;
            }
        }
        catch (Exception ex)
        {
            CPH.LogError("[Acrone] Error in !collection: " + ex.Message);
            return false;
        }
    }
}
```

---

### Command 2: `!fish`, `!mine`, `!chest` (Collection Discoveries)

When a viewer wins an item in a mini-game, submit the idempotent event to the website:

```csharp
using System;
using System.Net.Http;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly HttpClient client = new HttpClient();
    private const string API_URL = "https://your-acrone-project.vercel.app/api/v1/bot/collection-events";
    private const string BOT_SECRET = "your_production_bot_secret_here";

    public bool RecordItemFind(string channelId, string displayName, string itemId, string category, int quantity = 1)
    {
        string eventId = "evt_" + Guid.NewGuid().ToString("N");

        var payload = new
        {
            eventId = eventId,
            youtubeChannelId = channelId,
            itemId = itemId,
            quantity = quantity,
            source = category, // "fishing", "mining", or "chest"
            occurredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        string json = JsonConvert.SerializeObject(payload);

        try
        {
            var request = AcroneApiHelper.CreateSignedRequest(HttpMethod.Post, API_URL, json, BOT_SECRET);
            var response = client.SendAsync(request).Result;
            string body = response.Content.ReadAsStringAsync().Result;

            if (response.IsSuccessStatusCode)
            {
                dynamic data = JsonConvert.DeserializeObject(body);
                string itemName = data.item.name;
                string rarity = data.item.rarity;
                int newQty = data.item.newQuantity;

                CPH.SendYouTubeMessage($"🎣 @{displayName} caught a [{rarity}] {itemName}! (Owned: ×{newQty})");
                return true;
            }
            return false;
        }
        catch (Exception ex)
        {
            CPH.LogError("[Acrone] Collection event error: " + ex.Message);
            return false;
        }
    }
}
```

---

### Command 3: `!sell` (Two-Phase Atomic Selling)

Safely reserve items on the website before crediting Acrone Points. If crediting fails, the reservation is cancelled so the player never loses items without getting points.

```csharp
using System;
using System.Net.Http;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly HttpClient client = new HttpClient();
    private const string BASE_URL = "https://your-acrone-project.vercel.app";
    private const string BOT_SECRET = "your_production_bot_secret_here";

    public bool SellItem(string channelId, string displayName, string itemId, int quantity)
    {
        string reservationId = "res_" + Guid.NewGuid().ToString("N");

        // Step 1: Reserve item
        var reservePayload = new
        {
            reservationId = reservationId,
            youtubeChannelId = channelId,
            itemId = itemId,
            quantity = quantity
        };
        string reserveJson = JsonConvert.SerializeObject(reservePayload);

        var reserveReq = AcroneApiHelper.CreateSignedRequest(
            HttpMethod.Post,
            $"{BASE_URL}/api/v1/bot/sales/reserve",
            reserveJson,
            BOT_SECRET
        );
        var reserveRes = client.SendAsync(reserveReq).Result;
        string reserveBody = reserveRes.Content.ReadAsStringAsync().Result;

        if (!reserveRes.IsSuccessStatusCode)
        {
            CPH.SendYouTubeMessage($"@{displayName} You don't have enough copies of this item to sell.");
            return false;
        }

        dynamic reserveData = JsonConvert.DeserializeObject(reserveBody);
        int pointsToCredit = (int)reserveData.suggestedSaleValueTotal;

        // Step 2: Credit Acrone Points locally in Streamer.bot
        bool pointsCredited = CreditPlayerPoints(channelId, pointsToCredit);

        if (pointsCredited)
        {
            // Step 3A: Commit the sale
            var commitPayload = new { reservationId = reservationId };
            string commitJson = JsonConvert.SerializeObject(commitPayload);
            var commitReq = AcroneApiHelper.CreateSignedRequest(
                HttpMethod.Post,
                $"{BASE_URL}/api/v1/bot/sales/commit",
                commitJson,
                BOT_SECRET
            );
            client.SendAsync(commitReq).Wait();

            CPH.SendYouTubeMessage($"💰 @{displayName} sold ×{quantity} item(s) for +{pointsToCredit} Goti!");
            return true;
        }
        else
        {
            // Step 3B: Cancel reservation to restore items
            var cancelPayload = new { reservationId = reservationId, reason = "Local credit failed" };
            string cancelJson = JsonConvert.SerializeObject(cancelPayload);
            var cancelReq = AcroneApiHelper.CreateSignedRequest(
                HttpMethod.Post,
                $"{BASE_URL}/api/v1/bot/sales/cancel",
                cancelJson,
                BOT_SECRET
            );
            client.SendAsync(cancelReq).Wait();

            CPH.SendYouTubeMessage($"@{displayName} Points transaction failed. Your inventory was preserved.");
            return false;
        }
    }

    private bool CreditPlayerPoints(string channelId, int points)
    {
        // Add points using your Streamer.bot points action or local DB
        return true;
    }
}
```
