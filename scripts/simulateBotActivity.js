import crypto from 'node:crypto';
import { PlayerService } from '../server/services/playerService.js';
import { InventoryService } from '../server/services/inventoryService.js';
import { AchievementService } from '../server/services/achievementService.js';

console.log('🤖 Starting Streamer.bot Activity Simulator...');

const testChannelId = 'UC_sample_pixel_pirate_101';
const displayName = 'PixelPirate';

// 1. Simulate viewer chatting !collection
console.log(`\n💬 [Chat] ${displayName}: !collection`);
const player = PlayerService.upsertPlayer({
  youtubeChannelId: testChannelId,
  displayName,
  avatarUrl: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=120&auto=format&fit=crop&q=80'
});
console.log(`🤖 [Bot Reply] @${displayName} Your collection: ${player.collectionUrl}`);

// 2. Simulate viewer playing !fish and catching a Rare Golden Koi
console.log(`\n💬 [Chat] ${displayName}: !fish`);
const eventId1 = 'sim_fish_' + crypto.randomUUID();
const findResult1 = InventoryService.recordCollectionEvent({
  eventId: eventId1,
  youtubeChannelId: testChannelId,
  itemId: 'fish_golden_koi',
  quantity: 1,
  source: 'fishing'
});
console.log(`🎣 [Game Result] Caught Golden Koi! New Quantity: ×${findResult1.item.newQuantity}`);
console.log(`⚡ [Realtime SSE] Dispatched 'inventory_updated' and 'stats_updated' to public profile!`);

// 3. Simulate viewer playing !mine and discovering an Astral Mithril Vein
console.log(`\n💬 [Chat] ${displayName}: !mine`);
const eventId2 = 'sim_mine_' + crypto.randomUUID();
const findResult2 = InventoryService.recordCollectionEvent({
  eventId: eventId2,
  youtubeChannelId: testChannelId,
  itemId: 'ore_astral_mithril',
  quantity: 1,
  source: 'mining'
});
console.log(`💎 [Game Result] Struck Astral Mithril! New Quantity: ×${findResult2.item.newQuantity}`);

// 4. Simulate viewer selling an item via chat !sell
console.log(`\n💬 [Chat] ${displayName}: !sell Common Sardine 2`);
const resId = 'sim_res_' + crypto.randomUUID();

// Phase 1: Reserve
const reserveResult = InventoryService.reserveSale({
  reservationId: resId,
  youtubeChannelId: testChannelId,
  itemId: 'fish_common_sardine',
  quantity: 2
});
console.log(`🔒 [Sale Phase 1] Reserved 2 Sardines. Goti to credit: ${reserveResult.suggestedSaleValueTotal}`);

// Phase 2: Commit (after bot ledger credits points)
const commitResult = InventoryService.commitSale({
  reservationId: resId
});
console.log(`✅ [Sale Phase 2] Sale committed. Remaining quantity: ×${commitResult.newQuantity} (Discovered: ${commitResult.isStillDiscovered})`);

// 5. Final Stats Check
const finalStats = PlayerService.getPlayerStats(player.id);
console.log('\n📊 Updated Collection Overview:');
console.log(`- Unique Items: ${finalStats.uniqueItemTypes}`);
console.log(`- Total Items: ${finalStats.totalQuantity}`);
console.log(`- Fish: ${finalStats.categories.fish.discovered}/${finalStats.categories.fish.total} (${finalStats.categories.fish.completionPercentage}%)`);
console.log(`- Mining: ${finalStats.categories.mining.discovered}/${finalStats.categories.mining.total} (${finalStats.categories.mining.completionPercentage}%)`);
console.log(`- Chest: ${finalStats.categories.chest.discovered}/${finalStats.categories.chest.total} (${finalStats.categories.chest.completionPercentage}%)`);
console.log(`- Master Completion: ${finalStats.overallCompletionPercentage}%`);

console.log('\n✨ Simulation complete! Open the public profile at /u/' + player.publicPlayerId + ' to see changes reflected.');
