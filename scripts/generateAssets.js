import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../server/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.resolve(__dirname, '../public');
const itemsDir = path.join(publicDir, 'assets/items');
const badgesDir = path.join(publicDir, 'assets/badges');

if (!fs.existsSync(itemsDir)) fs.mkdirSync(itemsDir, { recursive: true });
if (!fs.existsSync(badgesDir)) fs.mkdirSync(badgesDir, { recursive: true });

const db = getDb();

// Rarity glow maps
const rarityColors = {
  common: '#9CA3AF',
  uncommon: '#10B981',
  rare: '#3B82F6',
  epic: '#8B5CF6',
  legendary: '#F59E0B',
  mythic: '#D83C53'
};

function generateFishSvg(item, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <defs>
    <radialGradient id="bg_${item.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1F2028"/>
      <stop offset="100%" stop-color="#0E0F14"/>
    </radialGradient>
    <linearGradient id="glow_${item.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.2"/>
    </linearGradient>
    <filter id="shadow_${item.id}">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${color}" flood-opacity="0.4"/>
    </filter>
  </defs>
  <rect width="96" height="96" x="2" y="2" rx="16" fill="url(#bg_${item.id})" stroke="${color}" stroke-width="1.5" stroke-opacity="0.4"/>
  <!-- Ambient Wave Motif -->
  <path d="M15 75 Q 35 68, 50 75 T 85 75" fill="none" stroke="${color}" stroke-width="1" stroke-opacity="0.2"/>
  <path d="M15 82 Q 35 75, 50 82 T 85 82" fill="none" stroke="${color}" stroke-width="1" stroke-opacity="0.15"/>
  <!-- Stylized Fish Shape -->
  <g filter="url(#shadow_${item.id})" transform="translate(10, 16) scale(0.8)">
    <!-- Caudal Fin / Tail -->
    <path d="M 18 40 L 2 24 C 8 36, 8 44, 2 56 Z" fill="url(#glow_${item.id})"/>
    <!-- Dorsal Fin -->
    <path d="M 42 22 C 55 12, 68 18, 62 26 Z" fill="${color}" fill-opacity="0.6"/>
    <!-- Pelvic / Anal Fin -->
    <path d="M 38 56 C 48 64, 58 60, 52 54 Z" fill="${color}" fill-opacity="0.5"/>
    <!-- Main Body -->
    <path d="M 18 40 C 25 24, 60 22, 78 40 C 60 58, 25 56, 18 40 Z" fill="url(#glow_${item.id})"/>
    <!-- Scale Accents -->
    <path d="M 38 34 Q 44 40, 38 46" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-opacity="0.5"/>
    <path d="M 46 32 Q 52 40, 46 48" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-opacity="0.6"/>
    <path d="M 54 36 Q 60 40, 54 44" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-opacity="0.7"/>
    <!-- Eye -->
    <circle cx="70" cy="36" r="3.5" fill="#FFFFFF"/>
    <circle cx="71" cy="36" r="1.8" fill="#000000"/>
  </g>
  <circle cx="86" cy="14" r="3" fill="${color}"/>
</svg>`;
}

function generateMiningSvg(item, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <defs>
    <radialGradient id="bg_${item.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1F2028"/>
      <stop offset="100%" stop-color="#0E0F14"/>
    </radialGradient>
    <linearGradient id="facetA_${item.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${color}"/>
    </linearGradient>
    <linearGradient id="facetB_${item.id}" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="#0A0A0F"/>
    </linearGradient>
    <filter id="shadow_${item.id}">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${color}" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="96" height="96" x="2" y="2" rx="16" fill="url(#bg_${item.id})" stroke="${color}" stroke-width="1.5" stroke-opacity="0.4"/>
  <!-- Subterranean Strata Lines -->
  <path d="M12 28 L 88 32" stroke="${color}" stroke-width="1" stroke-opacity="0.15"/>
  <path d="M12 70 L 88 66" stroke="${color}" stroke-width="1" stroke-opacity="0.15"/>
  <!-- Crystalline Cluster -->
  <g filter="url(#shadow_${item.id})" transform="translate(18, 18) scale(0.65)">
    <!-- Base Cluster Rocks -->
    <polygon points="15,75 35,45 65,55 85,85 10,85" fill="url(#facetB_${item.id})" opacity="0.8"/>
    <!-- Main Crystal Prism -->
    <polygon points="50,10 75,40 50,85 25,40" fill="url(#facetA_${item.id})"/>
    <!-- Left Facet -->
    <polygon points="50,10 25,40 50,85" fill="${color}" fill-opacity="0.6"/>
    <!-- Right Facet Highlights -->
    <polygon points="50,10 75,40 50,85" fill="#FFFFFF" fill-opacity="0.3"/>
    <!-- Secondary Crystal -->
    <polygon points="75,30 95,50 80,78 65,55" fill="url(#facetA_${item.id})" opacity="0.9"/>
    <!-- Sparkle Specular Points -->
    <polygon points="50,6 52,10 56,10 53,13 54,17 50,14 46,17 47,13 44,10 48,10" fill="#FFFFFF"/>
  </g>
  <polygon points="84,12 88,16 84,20 80,16" fill="${color}"/>
</svg>`;
}

function generateChestSvg(item, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <defs>
    <radialGradient id="bg_${item.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1F2028"/>
      <stop offset="100%" stop-color="#0E0F14"/>
    </radialGradient>
    <linearGradient id="gold_${item.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFDF00"/>
      <stop offset="100%" stop-color="${color}"/>
    </linearGradient>
    <filter id="shadow_${item.id}">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${color}" flood-opacity="0.4"/>
    </filter>
  </defs>
  <rect width="96" height="96" x="2" y="2" rx="16" fill="url(#bg_${item.id})" stroke="${color}" stroke-width="1.5" stroke-opacity="0.4"/>
  <!-- Nautical / Relic Halo -->
  <circle cx="50" cy="50" r="34" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3,4" stroke-opacity="0.25"/>
  <!-- Treasure Chest Icon -->
  <g filter="url(#shadow_${item.id})" transform="translate(18, 20) scale(0.65)">
    <!-- Lower Chest Body -->
    <rect x="10" y="42" width="80" height="42" rx="6" fill="#2A1B14" stroke="${color}" stroke-width="3"/>
    <!-- Iron Straps -->
    <rect x="22" y="42" width="8" height="42" fill="${color}" fill-opacity="0.8"/>
    <rect x="70" y="42" width="8" height="42" fill="${color}" fill-opacity="0.8"/>
    <!-- Lid Arc -->
    <path d="M 10 42 C 10 18, 90 18, 90 42 Z" fill="#3D261C" stroke="${color}" stroke-width="3"/>
    <!-- Lid Straps -->
    <path d="M 22 42 C 22 23, 30 23, 30 42 Z" fill="${color}" fill-opacity="0.8"/>
    <path d="M 70 42 C 70 23, 78 23, 78 42 Z" fill="${color}" fill-opacity="0.8"/>
    <!-- Keyhole Lock Core -->
    <rect x="42" y="38" width="16" height="18" rx="3" fill="url(#gold_${item.id})" stroke="#000" stroke-width="1.5"/>
    <circle cx="50" cy="45" r="2.5" fill="#000000"/>
    <polygon points="49,45 51,45 52,52 48,52" fill="#000000"/>
    <!-- Glowing Treasure Spill Line -->
    <line x1="12" y1="42" x2="88" y2="42" stroke="#FFF" stroke-width="2" stroke-opacity="0.8"/>
  </g>
  <circle cx="86" cy="14" r="3" fill="${color}"/>
</svg>`;
}

function generateBadgeSvg(badge) {
  const color = '#D83C53'; // Crimson
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <defs>
    <radialGradient id="bg_${badge.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2D151B"/>
      <stop offset="100%" stop-color="#0E0F14"/>
    </radialGradient>
    <linearGradient id="crimsonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF5B73"/>
      <stop offset="100%" stop-color="#8F293B"/>
    </linearGradient>
    <filter id="badgeGlow">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#D83C53" flood-opacity="0.6"/>
    </filter>
  </defs>
  <!-- Shield Outline -->
  <path d="M 50 8 L 86 22 C 86 62, 50 88, 50 88 C 50 88, 14 62, 14 22 Z" 
        fill="url(#bg_${badge.id})" stroke="url(#crimsonGrad)" stroke-width="3" filter="url(#badgeGlow)"/>
  <!-- Inner Shield Trim -->
  <path d="M 50 16 L 78 27 C 78 58, 50 78, 50 78 C 50 78, 22 58, 22 27 Z" 
        fill="none" stroke="#D83C53" stroke-width="1.5" stroke-opacity="0.4"/>
  <!-- Star / Emblem in Center -->
  <g transform="translate(30, 28) scale(0.4)">
    <polygon points="50,5 64,36 98,36 70,56 81,88 50,68 19,88 30,56 2,36 36,36" 
             fill="url(#crimsonGrad)" stroke="#FFFFFF" stroke-width="2"/>
  </g>
  <circle cx="50" cy="50" r="5" fill="#FFFFFF" opacity="0.9"/>
</svg>`;
}

// Generate all item assets
const items = db.prepare(`
  SELECT ci.*, r.id as rarity_id
  FROM catalog_items ci
  JOIN rarities r ON ci.rarity_id = r.id
`).all();

let countItems = 0;
for (const item of items) {
  const color = rarityColors[item.rarity_id] || '#9CA3AF';
  let svgContent = '';
  if (item.category === 'fish') {
    svgContent = generateFishSvg(item, color);
  } else if (item.category === 'mining') {
    svgContent = generateMiningSvg(item, color);
  } else {
    svgContent = generateChestSvg(item, color);
  }

  const filePath = path.join(itemsDir, `${item.id}.svg`);
  fs.writeFileSync(filePath, svgContent, 'utf8');
  countItems++;
}

// Fallback generic item
fs.writeFileSync(path.join(itemsDir, 'fallback_item.svg'), generateFishSvg({ id: 'fallback' }, '#777782'), 'utf8');

// Generate all badge assets
const badges = db.prepare('SELECT * FROM achievements').all();
let countBadges = 0;
for (const badge of badges) {
  const svg = generateBadgeSvg(badge);
  const badgeFile = path.basename(badge.badge_icon) || `${badge.id}.svg`;
  fs.writeFileSync(path.join(badgesDir, badgeFile), svg, 'utf8');
  countBadges++;
}

// Fallback generic badge
fs.writeFileSync(path.join(badgesDir, 'fallback_badge.svg'), generateBadgeSvg({ id: 'fallback' }), 'utf8');

console.log(`🎨 Successfully generated ${countItems} collectible SVG vector artworks and ${countBadges} badge icons!`);
