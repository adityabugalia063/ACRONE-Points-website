import { getDb } from './index.js';
import crypto from 'node:crypto';
import { AchievementService } from '../services/achievementService.js';

export function runSeed() {
  const db = getDb();
  console.log('🌱 Starting database seeding...');

  // 1. Seed Rarities
  const rarities = [
    { id: 'common', name: 'Common', display_color: '#9CA3AF', sort_order: 1 },
    { id: 'uncommon', name: 'Uncommon', display_color: '#10B981', sort_order: 2 },
    { id: 'rare', name: 'Rare', display_color: '#3B82F6', sort_order: 3 },
    { id: 'epic', name: 'Epic', display_color: '#8B5CF6', sort_order: 4 },
    { id: 'legendary', name: 'Legendary', display_color: '#F59E0B', sort_order: 5 },
    { id: 'mythic', name: 'Mythic', display_color: '#D83C53', sort_order: 6 } // Crimson accent
  ];

  const stmtRarity = db.prepare(`
    INSERT INTO rarities (id, name, display_color, sort_order, active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      display_color = excluded.display_color,
      sort_order = excluded.sort_order
  `);

  for (const r of rarities) {
    stmtRarity.run(r.id, r.name, r.display_color, r.sort_order);
  }
  console.log(`✅ Seeded ${rarities.length} rarity tiers`);

  // 2. Seed Fish Collection (60 items)
  const fishItems = [
    // Common (15)
    { id: 'fish_common_sardine', name: 'Common Sardine', rarity: 'common', desc: 'A staple bait fish found schooling in coastal shallows.', val: 10 },
    { id: 'fish_pond_perch', name: 'Pond Perch', rarity: 'common', desc: 'A lively freshwater fish with dusky olive bands.', val: 12 },
    { id: 'fish_stream_minnow', name: 'Stream Minnow', rarity: 'common', desc: 'Darting tiny fish common in babbling brooks.', val: 10 },
    { id: 'fish_mud_carp', name: 'Mud Carp', rarity: 'common', desc: 'Hardy bottom-feeder accustomed to murky shallows.', val: 15 },
    { id: 'fish_bluegill', name: 'Bluegill', rarity: 'common', desc: 'Flavored panfish with a trademark ear flap spot.', val: 14 },
    { id: 'fish_river_chub', name: 'River Chub', rarity: 'common', desc: 'Stout river dweller that frequently bites novice hooks.', val: 12 },
    { id: 'fish_sand_goby', name: 'Sand Goby', rarity: 'common', desc: 'Camouflaged bottom-dweller of tidal estuaries.', val: 15 },
    { id: 'fish_brook_trout', name: 'Brook Trout', rarity: 'common', desc: 'Crisp mountain stream swimmer with patterned flanks.', val: 18 },
    { id: 'fish_spotted_crappie', name: 'Spotted Crappie', rarity: 'common', desc: 'Schooling fish favoring submerged logs and weeds.', val: 16 },
    { id: 'fish_channel_catfish', name: 'Channel Catfish', rarity: 'common', desc: 'Whiskered scavenger with acute nocturnal senses.', val: 20 },
    { id: 'fish_striped_mullet', name: 'Striped Mullet', rarity: 'common', desc: 'Agile jumper often seen leaping over calm coastal bays.', val: 18 },
    { id: 'fish_herring', name: 'Silver Herring', rarity: 'common', desc: 'Glinting silver swimmer migrating in massive shoals.', val: 15 },
    { id: 'fish_anchovy', name: 'Ocean Anchovy', rarity: 'common', desc: 'Tiny, salty ocean wanderer favored by pelagic predators.', val: 12 },
    { id: 'fish_bullhead', name: 'Yellow Bullhead', rarity: 'common', desc: 'Tenacious mud-dweller that endures oxygen-depleted pools.', val: 16 },
    { id: 'fish_sunfish', name: 'Pumpkinseed Sunfish', rarity: 'common', desc: 'Vibrant disc-shaped fish with iridescent turquoise streaks.', val: 18 },

    // Uncommon (15)
    { id: 'fish_rainbow_trout', name: 'Rainbow Trout', rarity: 'uncommon', desc: 'Flashes a brilliant crimson stripe when breaking water.', val: 35 },
    { id: 'fish_largemouth_bass', name: 'Largemouth Bass', rarity: 'uncommon', desc: 'Aggressive ambush hunter of freshwater shorelines.', val: 40 },
    { id: 'fish_walleye', name: 'Golden Walleye', rarity: 'uncommon', desc: 'Large reflective eyes suited for twilight hunting.', val: 45 },
    { id: 'fish_atlantic_cod', name: 'Atlantic Cod', rarity: 'uncommon', desc: 'Cold deepwater staple prized by coastal fishermen.', val: 40 },
    { id: 'fish_spotted_flounder', name: 'Spotted Flounder', rarity: 'uncommon', desc: 'Flat camouflage master blending into tidal seafloors.', val: 42 },
    { id: 'fish_king_mackerel', name: 'King Mackerel', rarity: 'uncommon', desc: 'Torpedo-shaped ocean sprinter with razor-sharp teeth.', val: 50 },
    { id: 'fish_lake_sturgeon', name: 'River Sturgeon', rarity: 'uncommon', desc: 'Ancient armored fish patrolling slow river bottoms.', val: 55 },
    { id: 'fish_red_snapper', name: 'Crimson Snapper', rarity: 'uncommon', desc: 'Deep-bodied reef predator with brilliant scarlet scales.', val: 50 },
    { id: 'fish_tiger_muskie', name: 'Tiger Muskie', rarity: 'uncommon', desc: 'Fierce hybrid pike with distinct vertical stripes.', val: 60 },
    { id: 'fish_mahi_mahi', name: 'Dorado Mahi', rarity: 'uncommon', desc: 'Dazzling neon yellow and emerald pelagic speedster.', val: 65 },
    { id: 'fish_halibut', name: 'Pacific Halibut', rarity: 'uncommon', desc: 'Heavy flatfish hiding in chilly continental trenches.', val: 55 },
    { id: 'fish_sea_bass', name: 'Black Sea Bass', rarity: 'uncommon', desc: 'Structure-dwelling saltwater predator with indigo hues.', val: 48 },
    { id: 'fish_arctic_char', name: 'Arctic Char', rarity: 'uncommon', desc: 'Glacial water inhabitant with fiery orange underbelly.', val: 52 },
    { id: 'fish_barramundi', name: 'Barramundi', rarity: 'uncommon', desc: 'Fierce tidal river fighter that leaps when hooked.', val: 58 },
    { id: 'fish_cutthroat_trout', name: 'Cutthroat Trout', rarity: 'uncommon', desc: 'Marked by distinctive crimson slashes beneath the lower jaw.', val: 45 },

    // Rare (12)
    { id: 'fish_golden_koi', name: 'Golden Koi', rarity: 'rare', desc: 'Auspicious shimmering carp revered across ancient waterways.', val: 120 },
    { id: 'fish_sailfish', name: 'Cobalt Sailfish', rarity: 'rare', desc: 'One of the fastest hunters in the open ocean with huge dorsal sail.', val: 150 },
    { id: 'fish_yellowfin_tuna', name: 'Yellowfin Tuna', rarity: 'rare', desc: 'Massive muscular powerhouse capable of intense ocean journeys.', val: 140 },
    { id: 'fish_electric_eel', name: 'Surge Eel', rarity: 'rare', desc: 'Produces crackling bio-electric shocks to stun prey.', val: 160 },
    { id: 'fish_swordfish', name: 'Broadbill Swordfish', rarity: 'rare', desc: 'Apex oceanic billfish armed with a lethal elongated bill.', val: 175 },
    { id: 'fish_oarfish', name: 'Giant Oarfish', rarity: 'rare', desc: 'Serpentine abyssal messenger with fiery red crest fins.', val: 190 },
    { id: 'fish_coelacanth', name: 'Primeval Coelacanth', rarity: 'rare', desc: 'Living fossil thought extinct for tens of millions of years.', val: 220 },
    { id: 'fish_ghost_carp', name: 'Ghost Carp', rarity: 'rare', desc: 'Pale spectral carp gliding silently through midnight ponds.', val: 180 },
    { id: 'fish_viperfish', name: 'Abyssal Viperfish', rarity: 'rare', desc: 'Deep-sea monster with fang-like teeth and bioluminescent photophores.', val: 210 },
    { id: 'fish_lionfish', name: 'Ornate Lionfish', rarity: 'rare', desc: 'Venomous spines fan out like regal crimson feathers.', val: 165 },
    { id: 'fish_arowana', name: 'Dragon Arowana', rarity: 'rare', desc: 'Legendary freshwater predator dubbed the aquatic dragon.', val: 240 },
    { id: 'fish_moonfish', name: 'Radiant Opah', rarity: 'rare', desc: 'Warm-blooded deep sea disc glowing with silver and red spots.', val: 230 },

    // Epic (10)
    { id: 'fish_abyssal_angler', name: 'Abyssal Angler', rarity: 'epic', desc: 'Lures prey out of eternal darkness with a hypnotic glowing lure.', val: 450 },
    { id: 'fish_crimson_manta', name: 'Crimson Manta Ray', rarity: 'epic', desc: 'Majestic winged giant gliding on volcanic thermal currents.', val: 500 },
    { id: 'fish_crystal_tetra', name: 'Prismatic Tetra', rarity: 'epic', desc: 'Body refracts ambient light into radiant rainbow beams.', val: 480 },
    { id: 'fish_frost_pike', name: 'Glacier Pike', rarity: 'epic', desc: 'Thrives inside frozen ice sheets, breath cold enough to frost lures.', val: 520 },
    { id: 'fish_magma_guppy', name: 'Magma Guppy', rarity: 'epic', desc: 'Swims through boiling subterranean sulfur lakes.', val: 550 },
    { id: 'fish_phantom_ray', name: 'Phantom Ghost Ray', rarity: 'epic', desc: 'Semi-translucent ray that phases through ocean thermoclines.', val: 580 },
    { id: 'fish_solar_salmon', name: 'Solaris Salmon', rarity: 'epic', desc: 'Scales charged by intense sunlight leap higher than waterfalls.', val: 600 },
    { id: 'fish_storm_barracuda', name: 'Tempest Barracuda', rarity: 'epic', desc: 'Surrounded by micro-lightning arcs during ocean squalls.', val: 620 },
    { id: 'fish_obsidian_gar', name: 'Obsidian Gar', rarity: 'epic', desc: 'Scales as hard as volcanic glass deflect common hook points.', val: 650 },
    { id: 'fish_emerald_hydra_fish', name: 'Verdant Hydra Bass', rarity: 'epic', desc: 'Rare mutation with multiple fin crowns and emerald sheen.', val: 700 },

    // Legendary (5)
    { id: 'fish_void_angler', name: 'Void Angler', rarity: 'legendary', desc: 'Absorbs light itself from the deepest oceanic trenches.', val: 1500 },
    { id: 'fish_celestial_leviathan_pup', name: 'Celestial Leviathan', rarity: 'legendary', desc: 'Young offspring of the mythical titan that commands the tides.', val: 1800 },
    { id: 'fish_astral_sturgeon', name: 'Starlight Sturgeon', rarity: 'legendary', desc: 'Carries miniature star constellations across its back plates.', val: 2000 },
    { id: 'fish_phoenix_koi', name: 'Phoenix Koi', rarity: 'legendary', desc: 'Legends say catching one ignites everlasting stream fortune.', val: 2400 },
    { id: 'fish_chrono_perch', name: 'Chrono Perch', rarity: 'legendary', desc: 'Darts between seconds, causing temporal ripples in the water.', val: 2800 },

    // Mythic (3)
    { id: 'fish_acrone_crimson_kraken', name: 'Acrone Crimson Kraken', rarity: 'mythic', desc: 'The apex sovereign of the Acrone seas, cloaked in royal crimson aura.', val: 5000 },
    { id: 'fish_elder_world_whale', name: 'Elder Tidal Behemoth', rarity: 'mythic', desc: 'Carries the memory of ancient submerged continents on its back.', val: 6000 },
    { id: 'fish_cosmic_hyperion', name: 'Hyperion Sun Fish', rarity: 'mythic', desc: 'Burns with thermonuclear plasma, legendary catch of stream champions.', val: 7500 }
  ];

  // 3. Seed Mining Collection (50 items)
  const miningItems = [
    // Common (12)
    { id: 'ore_rough_coal', name: 'Rough Coal', rarity: 'common', desc: 'Dense carbon fuel extracted from shallow rock strata.', val: 10 },
    { id: 'ore_limestone_shale', name: 'Limestone Shale', rarity: 'common', desc: 'Sedimentary rock layered with ancient mineral deposits.', val: 12 },
    { id: 'ore_native_copper', name: 'Native Copper', rarity: 'common', desc: 'Malleable red-orange metal found in cracked boulders.', val: 15 },
    { id: 'ore_bog_iron', name: 'Bog Iron Ore', rarity: 'common', desc: 'Porous iron oxide harvested from wetland rockbeds.', val: 18 },
    { id: 'ore_river_gravel', name: 'Garnet River Gravel', rarity: 'common', desc: 'Dense alluvial pebbles carrying coarse minerals.', val: 10 },
    { id: 'ore_tin_cassiterite', name: 'Cassiterite Ore', rarity: 'common', desc: 'Heavy dark tin mineral essential for bronze alloys.', val: 15 },
    { id: 'ore_halite_rock_salt', name: 'Rock Salt Crystal', rarity: 'common', desc: 'Translucent cubic salt block mined from dry seabeds.', val: 12 },
    { id: 'ore_granite_quartz', name: 'Granite Quartz', rarity: 'common', desc: 'Milky silicate crystal embedded in hard granite matrix.', val: 16 },
    { id: 'ore_slate_vein', name: 'Grey Slate Vein', rarity: 'common', desc: 'Fine-grained foliated stone mined for construction.', val: 14 },
    { id: 'ore_gypsum_rose', name: 'Gypsum Desert Rose', rarity: 'common', desc: 'Petal-shaped crystal formation shaped by wind and mineral brine.', val: 18 },
    { id: 'ore_pyrite_fools_gold', name: 'Pyrite Shard', rarity: 'common', desc: 'Deceptive brass-yellow mineral known as Fool’s Gold.', val: 20 },
    { id: 'ore_feldspar_cluster', name: 'Feldspar Cluster', rarity: 'common', desc: 'Common crust-forming crystalline rock component.', val: 15 },

    // Uncommon (12)
    { id: 'ore_hematite_iron', name: 'Hematite Lump', rarity: 'uncommon', desc: 'Heavy lustrous iron ore that leaves a blood-red streak.', val: 35 },
    { id: 'ore_malachite_nodule', name: 'Banded Malachite', rarity: 'uncommon', desc: 'Swirling emerald-green carbonate mineral with silky luster.', val: 40 },
    { id: 'ore_galena_lead', name: 'Cubic Galena', rarity: 'uncommon', desc: 'Dense silvery-metallic lead sulfide crystal.', val: 38 },
    { id: 'ore_bauxite_aluminum', name: 'Bauxite Ore', rarity: 'uncommon', desc: 'Porous reddish clay-like ore yielding pure aluminum.', val: 42 },
    { id: 'ore_sphalerite_zinc', name: 'Resinous Sphalerite', rarity: 'uncommon', desc: 'Sub-metallic zinc mineral glistening with honey resin sheen.', val: 45 },
    { id: 'ore_fluorite_cube', name: 'Purple Fluorite', rarity: 'uncommon', desc: 'Geometric cubic crystal that fluoresces under ultraviolet light.', val: 48 },
    { id: 'ore_raw_amber', name: 'Fossil Amber', rarity: 'uncommon', desc: 'Fossilized tree resin trapping prehistoric air bubbles.', val: 50 },
    { id: 'ore_cinnabar_quicksilver', name: 'Scarlet Cinnabar', rarity: 'uncommon', desc: 'Vivid red toxic ore from which liquid quicksilver is distilled.', val: 55 },
    { id: 'ore_rhodonite', name: 'Rose Rhodonite', rarity: 'uncommon', desc: 'Pink manganese silicate veined with black dendritic oxides.', val: 52 },
    { id: 'ore_chrysocolla', name: 'Sky Chrysocolla', rarity: 'uncommon', desc: 'Cyan copper silicate resembling tropical ocean shallows.', val: 58 },
    { id: 'ore_magnesite_nodule', name: 'White Magnesite', rarity: 'uncommon', desc: 'Pure porcelain-textured mineral mined from deep veins.', val: 45 },
    { id: 'ore_bornite_peacock', name: 'Peacock Bornite', rarity: 'uncommon', desc: 'Tarnishes into iridescent shades of violet, magenta, and blue.', val: 60 },

    // Rare (10)
    { id: 'ore_native_silver', name: 'Silver Filigree Ore', rarity: 'rare', desc: 'Branching dendritic silver veins running through quartz veins.', val: 120 },
    { id: 'ore_native_gold_nugget', name: 'Raw Gold Nugget', rarity: 'rare', desc: 'Heavy, lustrous natural gold nugget panned from ancient rock.', val: 160 },
    { id: 'ore_rough_sapphire', name: 'Star Sapphire', rarity: 'rare', desc: 'Deep corundum crystal exhibiting a luminous six-rayed asterism.', val: 180 },
    { id: 'ore_rough_ruby', name: 'Pigeon Blood Ruby', rarity: 'rare', desc: 'Fiery crimson gemstone prized by kings and guild masters.', val: 200 },
    { id: 'ore_rough_emerald', name: 'Beryl Emerald Prism', rarity: 'rare', desc: 'Hexagonal green prism mined from pegmatite pockets.', val: 190 },
    { id: 'ore_lapis_lazuli', name: 'Royal Lapis Lazuli', rarity: 'rare', desc: 'Ultramarine rock flecked with golden grains of pyrite.', val: 150 },
    { id: 'ore_raw_topaz', name: 'Imperial Topaz', rarity: 'rare', desc: 'Golden-orange silicate crystal of exceptional hardness.', val: 170 },
    { id: 'ore_black_opal', name: 'Lightning Ridge Opal', rarity: 'rare', desc: 'Dark gemstone flashing with intense rainbow fire.', val: 220 },
    { id: 'ore_titanium_rutile', name: 'Golden Rutile Quartz', rarity: 'rare', desc: 'Clear quartz pierced by brilliant needle-like titanium strands.', val: 185 },
    { id: 'ore_cobalt_skutterudite', name: 'Cobaltite Cluster', rarity: 'rare', desc: 'Brilliant metallic prism prized for synthesizing royal blue dyes.', val: 195 },

    // Epic (9)
    { id: 'ore_raw_platinum', name: 'Platinum Sponge Ore', rarity: 'epic', desc: 'Extremely dense noble metal resistant to the strongest acids.', val: 450 },
    { id: 'ore_rough_diamond', name: 'Kimberlite Diamond', rarity: 'epic', desc: 'Adamantine octahedral crystal forged under immense planetary pressure.', val: 550 },
    { id: 'ore_tanzanite_crystal', name: 'Pleochroic Tanzanite', rarity: 'epic', desc: 'Shifts between deep blue, violet, and burgundy when rotated.', val: 500 },
    { id: 'ore_alexandrite', name: 'Chameleon Alexandrite', rarity: 'epic', desc: 'Emerald green by day, glowing fiery red under candlelight.', val: 600 },
    { id: 'ore_meteorite_pallasite', name: 'Pallasite Star Shard', rarity: 'epic', desc: 'Extraterrestrial meteorite chunk embedding golden olivine crystals.', val: 650 },
    { id: 'ore_subterranean_bismuth', name: 'Rainbow Bismuth Hopper', rarity: 'epic', desc: 'Stepped geometric crystal shimmering with rainbow oxide films.', val: 480 },
    { id: 'ore_radioactive_uraninite', name: 'Pitchblende Geode', rarity: 'epic', desc: 'Heavily energetic mineral emitting faint subatomic warmth.', val: 520 },
    { id: 'ore_volcanic_obsidian_heart', name: 'Obsidian Fire Tear', rarity: 'epic', desc: 'Vitreous volcanic glass preserving frozen geothermal flames.', val: 580 },
    { id: 'ore_deep_adamant', name: 'Adamantine Node', rarity: 'epic', desc: 'Legendary subterranean metal harder than standard diamond bits.', val: 700 },

    // Legendary (5)
    { id: 'ore_astral_mithril', name: 'True Mithril Vein', rarity: 'legendary', desc: 'Light as a feather yet stronger than forged tempered steel.', val: 1800 },
    { id: 'ore_void_singularity_stone', name: 'Graviton Shard', rarity: 'legendary', desc: 'A dense mineral anomaly that exerts a miniature gravitational pull.', val: 2200 },
    { id: 'ore_sunfire_sulfur', name: 'Solaris Core Geode', rarity: 'legendary', desc: 'Crystallized stellar energy that illuminates pitch-black caverns.', val: 2500 },
    { id: 'ore_chrono_crystal', name: 'Timeless Quartz', rarity: 'legendary', desc: 'Internal light vibrations oscillate backwards through local seconds.', val: 2800 },
    { id: 'ore_draconic_bloodstone', name: 'Draconic Heart Gem', rarity: 'legendary', desc: 'Formed from ancient dragon fire deep within magma chambers.', val: 3200 },

    // Mythic (2)
    { id: 'ore_acrone_crimson_essence', name: 'Acrone Crimson Heartstone', rarity: 'mythic', desc: 'The master catalyst of the Acrone mountain, pulsing with boundless power.', val: 6000 },
    { id: 'ore_cosmic_genesis_matrix', name: 'Genesis Matrix Crystal', rarity: 'mythic', desc: 'Seed mineral from the birth of the galaxy containing primordial elements.', val: 7500 }
  ];

  // 4. Seed Mystery Chest Collection (25 items)
  const chestItems = [
    // Common (5)
    { id: 'chest_rusted_compass', name: 'Rusted Ship Compass', rarity: 'common', desc: 'An old brass mariner compass needle frozen pointing north.', val: 20 },
    { id: 'chest_tattered_sailor_log', name: 'Tattered Captain Log', rarity: 'common', desc: 'Waterlogged parchment recounting forgotten sea voyages.', val: 25 },
    { id: 'chest_tarnished_doubloon', name: 'Tarnished Doubloon', rarity: 'common', desc: 'An ancient coin stamped with a merchant fleet insignia.', val: 30 },
    { id: 'chest_glass_drift_bottle', name: 'Message in a Bottle', rarity: 'common', desc: 'Wax-sealed bottle containing an enigmatic map snippet.', val: 25 },
    { id: 'chest_carved_bone_dice', name: 'Carved Bone Dice', rarity: 'common', desc: 'Weighted tavern dice used in high-stakes harbor wagers.', val: 35 },

    // Uncommon (6)
    { id: 'chest_brass_spyglass', name: 'Navigator Spyglass', rarity: 'uncommon', desc: 'Collapsible telescope with precision ground optical glass.', val: 75 },
    { id: 'chest_corsair_cutlass_hilt', name: 'Corsair Cutlass Hilt', rarity: 'uncommon', desc: 'Basket-hilt of an infamous privateer boarding sword.', val: 80 },
    { id: 'chest_silver_pocket_watch', name: 'Engraved Pocket Watch', rarity: 'uncommon', desc: 'Still ticking rhythmically despite centuries submerged.', val: 90 },
    { id: 'chest_ancient_astrolabe', name: 'Brass Astrolabe', rarity: 'uncommon', desc: 'Intricate astronomical computer used to navigate by the stars.', val: 95 },
    { id: 'chest_merchant_seal_ring', name: 'Guild Signet Ring', rarity: 'uncommon', desc: 'Heavy signet ring used to seal royal shipping manifests.', val: 85 },
    { id: 'chest_ivory_pipe', name: 'Kraken Carved Pipe', rarity: 'uncommon', desc: 'Intricately etched with sea monsters battling galleons.', val: 70 },

    // Rare (6)
    { id: 'chest_sunken_galleon_anchor', name: 'Gilded Anchor Figurine', rarity: 'rare', desc: 'Solid cast silver amulet blessed for safe open ocean voyages.', val: 250 },
    { id: 'chest_cursed_chalice', name: 'Cursed Obsidian Chalice', rarity: 'rare', desc: 'Liquid poured into this vessel glows with an ominous purple mist.', val: 280 },
    { id: 'chest_clockwork_hummingbird', name: 'Clockwork Hummingbird', rarity: 'rare', desc: 'Delicate mechanical bird that flaps brass wings when wound.', val: 300 },
    { id: 'chest_treasure_map_eldorado', name: 'Eldorado Sea Chart', rarity: 'rare', desc: 'Parchment marked with invisible ink revealed only by moonlight.', val: 350 },
    { id: 'chest_siren_tear_vial', name: 'Siren Tear Vial', rarity: 'rare', desc: 'Luminescent brine harvested from mythological reef dwellers.', val: 320 },
    { id: 'chest_music_box_davy_jones', name: 'Abyssal Music Box', rarity: 'rare', desc: 'Plays a haunting melody that echoes across fog-covered waters.', val: 340 },

    // Epic (4)
    { id: 'chest_crown_of_atlantis', name: 'Sunken Crown of Atlantis', rarity: 'epic', desc: 'Encrusted with luminous pearls and iridescent sea-glass.', val: 800 },
    { id: 'chest_captain_flintlock', name: 'Dragonmouth Flintlock', rarity: 'epic', desc: 'Custom barrel engraved with gilded fire-breathing dragons.', val: 850 },
    { id: 'chest_phantom_ship_in_bottle', name: 'Phantom Galleon in Bottle', rarity: 'epic', desc: 'A spectral ship sails eternally inside this miniature stormy bottle.', val: 900 },
    { id: 'chest_sovereign_treasure_chest', name: 'Sovereign Royal Coffer', rarity: 'epic', desc: 'Reinforced ironbound trunk filled with ancient royal treasures.', val: 1000 },

    // Legendary (3)
    { id: 'chest_eye_of_the_leviathan', name: 'Eye of the Deep Sea God', rarity: 'legendary', desc: 'An enormous petrified orb that still tracks movement in the dark.', val: 2500 },
    { id: 'chest_neptune_trident_prong', name: 'Trident of Ocean Lords', rarity: 'legendary', desc: 'A fractured spearhead capable of parting ocean squalls.', val: 3000 },
    { id: 'chest_tome_of_forgotten_seas', name: 'Grimoire of the Siren Sea', rarity: 'legendary', desc: 'Bound in treated shark leather, whispering ancient maritime secrets.', val: 3500 },

    // Mythic (1)
    { id: 'chest_acrone_crimson_relic', name: 'Acrone Royal Reliquary', rarity: 'mythic', desc: 'The most sacred chest artifact of the Acrone order, pulsing with crimson flame.', val: 8000 }
  ];

  // Insert items statement
  const stmtItem = db.prepare(`
    INSERT INTO catalog_items (id, category, name, rarity_id, description, image_url, active, sort_order, base_sale_value)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      name = excluded.name,
      rarity_id = excluded.rarity_id,
      description = excluded.description,
      image_url = excluded.image_url,
      active = excluded.active,
      sort_order = excluded.sort_order,
      base_sale_value = excluded.base_sale_value
  `);

  let sortIndex = 1;
  for (const item of fishItems) {
    const img = `/assets/items/${item.id}.svg`;
    stmtItem.run(item.id, 'fish', item.name, item.rarity, item.desc, img, sortIndex++, item.val);
  }
  console.log(`✅ Seeded ${fishItems.length} Fish catalog items`);

  sortIndex = 1;
  for (const item of miningItems) {
    const img = `/assets/items/${item.id}.svg`;
    stmtItem.run(item.id, 'mining', item.name, item.rarity, item.desc, img, sortIndex++, item.val);
  }
  console.log(`✅ Seeded ${miningItems.length} Mining catalog items`);

  sortIndex = 1;
  for (const item of chestItems) {
    const img = `/assets/items/${item.id}.svg`;
    stmtItem.run(item.id, 'chest', item.name, item.rarity, item.desc, img, sortIndex++, item.val);
  }
  console.log(`✅ Seeded ${chestItems.length} Mystery Chest catalog items`);

  // 5. Seed Achievements
  const achievements = [
    {
      id: 'ach_first_catch',
      code: 'first_catch',
      name: 'First Cast',
      description: 'Hook and reel in your first fish from chat.',
      category: 'fish',
      badge_icon: '/assets/badges/first_catch.svg',
      requirement_type: 'unique_count',
      requirement_value: 1,
      sort_order: 1
    },
    {
      id: 'ach_angler_10',
      code: 'angler_10',
      name: 'Skilled Angler',
      description: 'Discover and currently own at least 10 unique fish species.',
      category: 'fish',
      badge_icon: '/assets/badges/angler_10.svg',
      requirement_type: 'unique_count',
      requirement_value: 10,
      sort_order: 2
    },
    {
      id: 'ach_angler_30',
      code: 'angler_30',
      name: 'Master of the Deep',
      description: 'Discover and currently own at least 30 unique fish species.',
      category: 'fish',
      badge_icon: '/assets/badges/angler_30.svg',
      requirement_type: 'unique_count',
      requirement_value: 30,
      sort_order: 3
    },
    {
      id: 'ach_first_strike',
      code: 'first_strike',
      name: 'Pickaxe Strike',
      description: 'Excavate your very first mineral or ore in mining chat games.',
      category: 'mining',
      badge_icon: '/assets/badges/first_strike.svg',
      requirement_type: 'unique_count',
      requirement_value: 1,
      sort_order: 4
    },
    {
      id: 'ach_miner_10',
      code: 'miner_10',
      name: 'Prospector',
      description: 'Discover and currently own at least 10 unique mineral specimens.',
      category: 'mining',
      badge_icon: '/assets/badges/miner_10.svg',
      requirement_type: 'unique_count',
      requirement_value: 10,
      sort_order: 5
    },
    {
      id: 'ach_miner_25',
      code: 'miner_25',
      name: 'Deep Earth Geologist',
      description: 'Discover and currently own at least 25 unique mineral specimens.',
      category: 'mining',
      badge_icon: '/assets/badges/miner_25.svg',
      requirement_type: 'unique_count',
      requirement_value: 25,
      sort_order: 6
    },
    {
      id: 'ach_chest_seeker',
      code: 'chest_seeker',
      name: 'Sunken Fortune',
      description: 'Unlock and own at least 5 mystery chest curiosities.',
      category: 'chest',
      badge_icon: '/assets/badges/chest_seeker.svg',
      requirement_type: 'unique_count',
      requirement_value: 5,
      sort_order: 7
    },
    {
      id: 'ach_grand_collector_25',
      code: 'grand_collector_25',
      name: 'Grand Collector',
      description: 'Hold a combined collection of at least 25 unique items across all categories.',
      category: 'all',
      badge_icon: '/assets/badges/grand_collector.svg',
      requirement_type: 'unique_count',
      requirement_value: 25,
      sort_order: 8
    },
    {
      id: 'ach_hoarder_100',
      code: 'hoarder_100',
      name: 'Vault Hoarder',
      description: 'Amass a total inventory quantity of 100 or more items.',
      category: 'all',
      badge_icon: '/assets/badges/vault_hoarder.svg',
      requirement_type: 'total_count',
      requirement_value: 100,
      sort_order: 9
    },
    {
      id: 'ach_mythic_owner',
      code: 'fish_acrone_crimson_kraken',
      name: 'Kraken Conqueror',
      description: 'Possess the mythical Acrone Crimson Kraken in your collection.',
      category: 'special',
      badge_icon: '/assets/badges/kraken_conqueror.svg',
      requirement_type: 'specific_item',
      requirement_value: 1,
      sort_order: 10
    }
  ];

  const stmtAch = db.prepare(`
    INSERT INTO achievements (id, code, name, description, category, badge_icon, requirement_type, requirement_value, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      badge_icon = excluded.badge_icon,
      requirement_type = excluded.requirement_type,
      requirement_value = excluded.requirement_value,
      sort_order = excluded.sort_order
  `);

  for (const ach of achievements) {
    stmtAch.run(
      ach.id, ach.code, ach.name, ach.desc || ach.description,
      ach.category, ach.badge_icon, ach.requirement_type,
      ach.requirement_value, ach.sort_order
    );
  }
  console.log(`✅ Seeded ${achievements.length} achievements`);

  // 6. Production Clean / Optional Demo Players
  const isDemo = process.argv.includes('--demo');

  if (isDemo) {
    console.log('🧪 Seeding demo test players (--demo flag detected)...');
    const samplePlayers = [
      {
        id: 'p_pixel_pirate',
        youtubeChannelId: 'UC_sample_pixel_pirate_101',
        publicPlayerId: 'usr_pixelpirate',
        displayName: 'PixelPirate',
        avatarUrl: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=120&auto=format&fit=crop&q=80'
      },
      {
        id: 'p_acrone_fan',
        youtubeChannelId: 'UC_sample_acrone_fan_202',
        publicPlayerId: 'usr_acronechampion',
        displayName: 'AcroneChampion',
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80'
      },
      {
        id: 'p_stream_lurker',
        youtubeChannelId: 'UC_sample_stream_lurker_303',
        publicPlayerId: 'usr_streamlurker',
        displayName: 'StreamLurker',
        avatarUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=120&auto=format&fit=crop&q=80'
      }
    ];

    const stmtPlayer = db.prepare(`
      INSERT INTO players (id, youtube_channel_id, public_player_id, display_name, avatar_url, created_at, updated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url
    `);

    const now = Date.now();
    for (const p of samplePlayers) {
      stmtPlayer.run(p.id, p.youtubeChannelId, p.publicPlayerId, p.displayName, p.avatarUrl, now - 86400000 * 10, now, now);
    }

    const pixelId = 'p_pixel_pirate';
    const stmtInv = db.prepare(`
      INSERT INTO player_inventory (player_id, item_id, quantity, first_found_at, last_found_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = excluded.quantity
    `);

    const pixelItems = [
      { id: 'fish_common_sardine', qty: 14 },
      { id: 'fish_golden_koi', qty: 3 },
      { id: 'fish_acrone_crimson_kraken', qty: 1 },
      { id: 'ore_rough_coal', qty: 25 },
      { id: 'ore_rough_ruby', qty: 1 },
      { id: 'chest_rusted_compass', qty: 5 }
    ];

    for (const item of pixelItems) {
      stmtInv.run(pixelId, item.id, item.qty, now - 86400000 * 5, now - 3600000, now);
    }

    AchievementService.evaluatePlayerAchievements(pixelId);
    console.log(`✅ Seeded ${samplePlayers.length} demo players`);
  } else {
    // Production clean: purge dummy sample players
    db.prepare("DELETE FROM sales_reservations WHERE player_id IN ('p_pixel_pirate', 'p_acrone_fan', 'p_stream_lurker')").run();
    db.prepare("DELETE FROM player_inventory WHERE player_id IN ('p_pixel_pirate', 'p_acrone_fan', 'p_stream_lurker')").run();
    db.prepare("DELETE FROM collection_events WHERE player_id IN ('p_pixel_pirate', 'p_acrone_fan', 'p_stream_lurker')").run();
    db.prepare("DELETE FROM player_achievements WHERE player_id IN ('p_pixel_pirate', 'p_acrone_fan', 'p_stream_lurker')").run();
    db.prepare("DELETE FROM players WHERE id IN ('p_pixel_pirate', 'p_acrone_fan', 'p_stream_lurker')").run();
    console.log('🧹 Production mode: Database verified clean with zero dummy test profiles.');
  }

  console.log('🎉 Seeding completed successfully!');
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  runSeed();
}
