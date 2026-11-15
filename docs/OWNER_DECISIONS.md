# Acrone Collection — Outstanding Owner Decisions & Configuration Checklist

As specified in the architectural guidelines, the following gameplay, economy, and deployment details are configured using data-driven database records and environment settings. They are ready for the project owner's final decisions:

---

## 1. Item Catalogue & Gameplay Finalization

| Area | Current Working Placeholder | Owner Decisions Required |
|---|---|---|
| **Fish Catalogue** | 60 placeholder species across 6 rarity tiers (Common to Mythic). Dynamic denominator. | Confirm final list of fish names, flavor descriptions, and drop biome tags. |
| **Mining Minerals** | 50 placeholder minerals/metals/gems. Dynamic denominator. | Confirm final mineral names, lore text, and whether mining tiers exist (e.g. depths/picks). |
| **Mystery Chest Items** | 25 nautical & ancient curiosity artifacts. Dynamic denominator. | Confirm final chest loot table size, item names, and drop rates. |
| **Unsellable Items** | All items currently carry a placeholder sale value. | Decide if any trophy/mythic items should have `is_sellable = 0` (permanent keep). |
| **Sale Values** | Scaled from 10 points (Common) up to 8,000 points (Mythic). | Confirm the official Acrone Points economy exchange rate per item. |

---

## 2. Visual Identity & Rarity Tiers

| Area | Current Implementation | Owner Decisions Required |
|---|---|---|
| **Rarity Tier Names** | Common, Uncommon, Rare, Epic, Legendary, Mythic. | Confirm tier hierarchy or customize names (e.g., Bronze, Silver, Gold, Celestial). |
| **Rarity Color Codes** | Common (`#9CA3AF`), Uncommon (`#10B981`), Rare (`#3B82F6`), Epic (`#8B5CF6`), Legendary (`#F59E0B`), Mythic (`#D83C53`). | Approve or tweak exact hex codes to match your stream overlay brand. |
| **Collectible Artwork** | Procedural vector SVGs generated for all 135 items with fallback handling. | Decide whether to keep the stylized SVG suite or replace with custom PNG/WebP raster art. Assets can be swapped into `public/assets/items/` without code changes. |

---

## 3. Achievements & Badges

| Area | Current Implementation | Owner Decisions Required |
|---|---|---|
| **Achievement Milestones** | 10 data-driven achievements (First Cast, 10/30 Fish, 10/25 Minerals, Chest Collector, Hoarder, Mythic Owner). | Confirm final list of badge titles, descriptions, and unlock thresholds. |
| **Revocation Rules** | If an item sale reduces unique count below the milestone, the badge is automatically revoked. | Confirm if all badges should enforce active ownership, or if certain badges should be permanent once unlocked. |

---

## 4. Hosting, Infrastructure & SEO

| Area | Current Setting | Owner Decisions Required |
|---|---|---|
| **Public Domain** | Default: `http://localhost:3000` (configurable via `SITE_BASE_URL`). | Confirm target production domain (e.g., `https://collection.acrone.gg` or `https://acronepoints.tv`). |
| **Hosting Provider** | Self-hosted Node.js / Docker ready (compatible with Railway, Render, Fly.io, or VPS). | Select deployment provider and setup HTTPS reverse proxy. |
| **Search Engine Indexing** | `ALLOW_SEARCH_INDEXING=false` (`X-Robots-Tag: noindex, nofollow`). | Decide whether public player profiles should appear on Google search results. |
| **Database Storage** | SQLite with WAL mode (`acrone_collection.db`). | Confirm whether SQLite meets capacity (~100,000+ viewers) or if PostgreSQL migration is desired. |
