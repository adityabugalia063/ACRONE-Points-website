/**
 * ACRONE COLLECTION — PUBLIC CLIENT APPLICATION
 * Single Page Application with native routing and real-time Server-Sent Events.
 */

// Application State
const state = {
  currentRoute: window.location.pathname,
  publicPlayerId: null,
  activeTab: 'overview', // 'overview', 'fish', 'mining', 'chest', 'achievements'
  player: null,
  stats: null,
  recentActivity: [],
  collection: null,
  achievements: null,
  filters: {
    search: '',
    rarity: 'all',
    status: 'all', // 'all', 'discovered', 'undiscovered'
    sort: 'rarity' // 'rarity', 'quantity', 'name'
  },
  sseStatus: 'disconnected', // 'connected', 'reconnecting', 'disconnected'
  eventSource: null,
  selectedItem: null,
  toastTimeout: null,
  syncMissedEventsTimer: null,
  lastSyncTimestamp: Date.now(),
  loadingWatchdogTimer: null
};

// Global variables initialized safely to avoid Temporal Dead Zone (TDZ)
window.syncMissedEventsTimer = null;
window.lastSyncTimestamp = Date.now();
window.processedEventIds = new Set();
var syncMissedEventsTimer = null;
var lastSyncTimestamp = Date.now();
var processedEventIds = window.processedEventIds;

// Initialize App
function startApp() {
  initRouter();
  window.addEventListener('popstate', handlePopState);
  document.body.addEventListener('click', handleLinkClick);

  // Delegated search form submission listener
  document.addEventListener('submit', (e) => {
    if (e.target && (e.target.id === 'home-search-form' || e.target.classList.contains('home-search-bar'))) {
      e.preventDefault();
      submitHomeSearch();
    }
  });

  // Delegated search button click listener
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#home-search-btn, .home-search-btn');
    if (btn && btn.closest('#home-search-form, .home-search-bar')) {
      e.preventDefault();
      submitHomeSearch();
    }
  });
}

/* ==========================================================================
   ROUTING
   ========================================================================== */

function initRouter() {
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    state.publicPlayerId = null;
    closeSse();
    const searchForm = document.getElementById('home-search-form');
    if (!searchForm) {
      renderHomePage();
    }
    return;
  }
  navigate(path, false);
}

function handlePopState() {
  navigate(window.location.pathname, false);
}

function handleLinkClick(e) {
  const link = e.target.closest('a[href^="/"]');
  if (link && !link.target && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const href = link.getAttribute('href');
    navigate(href, true);
  }
}

function navigate(urlPath, pushState = true) {
  state.currentRoute = urlPath;
  if (pushState) {
    window.history.pushState({}, '', urlPath);
  }

  // Parse Route
  // 1. Root: / or /u or /u/
  if (urlPath === '/' || urlPath === '' || urlPath === '/u' || urlPath === '/u/') {
    state.publicPlayerId = null;
    state.player = null;
    state.stats = null;
    state.collection = null;
    closeSse();
    renderHomePage();
    return;
  }

  // 2. Profile: /u/:publicPlayerId or /u/:publicPlayerId/:tab
  const match = urlPath.match(/^\/u\/([^/]+)(?:\/([^/]+))?/);
  if (match) {
    const newPlayerId = decodeURIComponent(match[1]);
    const newTab = match[2] || 'overview';

    const playerChanged = state.publicPlayerId !== newPlayerId;
    state.publicPlayerId = newPlayerId;
    state.activeTab = ['fish', 'mining', 'chest', 'achievements'].includes(newTab) ? newTab : 'overview';

    if (playerChanged || !state.player) {
      loadPlayerProfile(newPlayerId);
    } else {
      loadCurrentTab();
    }
    return;
  }

  // Unknown route -> render 404
  renderNotFound('Page Not Found');
}

window.navigate = navigate;

function submitHomeSearch() {
  const input = document.getElementById('home-search-input');
  const btn = document.querySelector('.home-search-btn, #home-search-btn');
  if (!input) return;

  let val = input.value.trim();
  val = val.replace(/^@/, '').trim();

  if (!val) {
    input.focus();
    input.classList.add('input-shake');
    setTimeout(() => input.classList.remove('input-shake'), 600);
    showToast('Input Required', 'Please enter your YouTube username or Collection ID.', '#EF4444');
    return;
  }

  // Immediate visual feedback on the button
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot" style="margin-right: 6px; width: 8px; height: 8px; display: inline-block;"></span> EXPLORING...`;
  }

  const resetButton = () => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'EXPLORE';
    }
  };

  // If input is directly a publicPlayerId (starts with usr_)
  if (val.toLowerCase().startsWith('usr_')) {
    navigate(`/u/${encodeURIComponent(val)}`, true);
    return;
  }

  // Lookup via public search endpoint
  fetch(`/api/public/search?query=${encodeURIComponent(val)}`)
    .then((res) => {
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    })
    .then((data) => {
      resetButton();
      if (data.results && data.results.length > 0) {
        // Find exact match first (case-insensitive)
        const exactMatch = data.results.find(
          (r) => r.displayName && r.displayName.toLowerCase() === val.toLowerCase()
        );
        const targetUrl = exactMatch ? exactMatch.profileUrl : data.results[0].profileUrl;
        navigate(targetUrl, true);
      } else {
        // Unregistered player -> route to dedicated Profile Not Found view
        navigate(`/u/${encodeURIComponent(val)}`, true);
      }
    })
    .catch(() => {
      resetButton();
      // Even if search endpoint encounters an error, route directly to player profile URL
      navigate(`/u/${encodeURIComponent(val)}`, true);
    });
}

window.submitHomeSearch = submitHomeSearch;

/* ==========================================================================
   REAL-TIME SERVER-SENT EVENTS (SSE) & CLOUD SYNC
   ========================================================================== */

function setupSse(publicPlayerId) {
  closeSse();

  lastSyncTimestamp = Date.now() - 5000;
  const streamUrl = `/api/public/players/${publicPlayerId}/stream`;
  state.sseStatus = 'reconnecting';
  updateSseIndicator();

  state.eventSource = new EventSource(streamUrl);

  state.eventSource.addEventListener('connected', () => {
    state.sseStatus = 'connected';
    updateSseIndicator();
    // Catch up on any events that occurred during connection establishment
    syncMissedEvents(publicPlayerId);
  });

  state.eventSource.addEventListener('inventory_updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      handleInventoryUpdateEvent(publicPlayerId, data);
    } catch (err) {
      console.error('SSE Error parsing inventory_updated:', err);
    }
  });

  state.eventSource.addEventListener('stats_updated', (e) => {
    try {
      const newStats = JSON.parse(e.data);
      state.stats = newStats;
      updateStatsDom();
    } catch (err) {
      console.error('SSE Error parsing stats_updated:', err);
    }
  });

  state.eventSource.addEventListener('balance_updated', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && typeof data.balance === 'number') {
        if (state.player) state.player.balance = data.balance;
        const heroEl = document.getElementById('hero-balance-val');
        if (heroEl) heroEl.textContent = data.balance.toLocaleString();
        const statEl = document.getElementById('stats-balance-val');
        if (statEl) statEl.textContent = data.balance.toLocaleString();
      }
    } catch (err) {
      console.error('SSE Error parsing balance_updated:', err);
    }
  });

  state.eventSource.addEventListener('achievement_unlocked', (e) => {
    try {
      const ach = JSON.parse(e.data);
      showToast('🏆 Achievement Unlocked!', ach.name, '#10B981');
      if (state.activeTab === 'achievements') {
        loadAchievements(publicPlayerId, false);
      }
    } catch (err) {}
  });

  state.eventSource.addEventListener('achievement_revoked', (e) => {
    try {
      const ach = JSON.parse(e.data);
      showToast('⚠️ Achievement Revoked', `${ach.name} (Requirement lost after sale)`, '#F59E0B');
      if (state.activeTab === 'achievements') {
        loadAchievements(publicPlayerId, false);
      }
    } catch (err) {}
  });

  state.eventSource.onerror = () => {
    state.sseStatus = 'reconnecting';
    updateSseIndicator();
    // Poll missed events during reconnection
    syncMissedEvents(publicPlayerId);
  };

  // Periodic fallback synchronization for multi-instance serverless resilience
  if (state.syncMissedEventsTimer) clearInterval(state.syncMissedEventsTimer);
  state.syncMissedEventsTimer = setInterval(() => {
    if (state.publicPlayerId === publicPlayerId && !document.hidden) {
      syncMissedEvents(publicPlayerId);
    }
  }, 8000);
  window.syncMissedEventsTimer = state.syncMissedEventsTimer;
  syncMissedEventsTimer = state.syncMissedEventsTimer;
}

function handleInventoryUpdateEvent(publicPlayerId, data) {
  const isFound = data.delta > 0;
  const title = isFound ? `Found ${data.itemName}` : `Sold ${data.itemName}`;
  const msg = isFound 
    ? `Added +${data.delta} to collection (Total: ×${data.newQuantity})`
    : `Removed ${Math.abs(data.delta)} from collection (Remaining: ×${data.newQuantity})`;

  showToast(title, msg, data.rarityColor || '#D83C53');

  // Refresh current tab data
  if (state.activeTab === 'overview') {
    loadPlayerProfile(publicPlayerId, false);
  } else if (state.activeTab === data.category) {
    loadCollectionCategory(publicPlayerId, data.category, false);
  }
}

async function syncMissedEvents(publicPlayerId) {
  if (!publicPlayerId) return;
  try {
    const res = await fetch(`/api/public/players/${publicPlayerId}/events?since=${lastSyncTimestamp}`);
    if (!res.ok) return;
    const json = await res.json();
    if (!json.events || json.events.length === 0) return;

    for (const ev of json.events) {
      if (processedEventIds.has(ev.id)) continue;
      processedEventIds.add(ev.id);
      if (processedEventIds.size > 200) {
        const oldest = processedEventIds.values().next().value;
        processedEventIds.delete(oldest);
      }

      lastSyncTimestamp = Math.max(lastSyncTimestamp, ev.occurredAt || Date.now());

      const isFound = ev.delta > 0;
      const title = isFound ? `Found ${ev.itemName}` : `Sold ${ev.itemName}`;
      const msg = isFound ? `Added +${ev.delta} to collection` : `Sold ${Math.abs(ev.delta)} item`;
      showToast(title, msg, ev.rarityColor || '#D83C53');
    }

    // Refresh current view with fresh stats
    if (state.activeTab === 'overview') {
      loadPlayerProfile(publicPlayerId, false);
    } else if (['fish', 'mining', 'chest'].includes(state.activeTab)) {
      loadCollectionCategory(publicPlayerId, state.activeTab, false);
    }
  } catch (_) {
    // Non-blocking background catch-up
  }
}

function closeSse() {
  try {
    if (state && state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
  } catch (_) {}

  try {
    if (state && state.syncMissedEventsTimer) {
      clearInterval(state.syncMissedEventsTimer);
      state.syncMissedEventsTimer = null;
    }
    if (window.syncMissedEventsTimer) {
      clearInterval(window.syncMissedEventsTimer);
      window.syncMissedEventsTimer = null;
    }
  } catch (_) {}

  try {
    if (state) {
      state.sseStatus = 'disconnected';
      updateSseIndicator();
    }
  } catch (err) {
    console.warn('closeSse warning:', err);
  }
}

function updateSseIndicator() {
  const el = document.getElementById('sse-indicator');
  if (!el) return;

  if (state.sseStatus === 'connected') {
    el.innerHTML = `<span class="pulse-dot"></span> Live Sync Active`;
    el.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  } else if (state.sseStatus === 'reconnecting') {
    el.innerHTML = `<span class="pulse-dot" style="background:#F59E0B"></span> Connecting...`;
    el.style.borderColor = 'rgba(245, 158, 11, 0.4)';
  } else {
    el.innerHTML = `<span class="pulse-dot disconnected"></span> Disconnected`;
    el.style.borderColor = 'rgba(239, 68, 68, 0.4)';
  }
}

function showToast(title, message, color = '#D83C53') {
  let toast = document.getElementById('live-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'live-toast';
    toast.className = 'live-toast';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <div style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; flex-shrink: 0; box-shadow: 0 0 8px ${color}"></div>
    <div>
      <div style="font-weight: 700; font-size: 0.85rem; color: #F4F4F6;">${title}</div>
      <div style="font-size: 0.75rem; color: #A2A2AD;">${message}</div>
    </div>
  `;

  toast.style.borderColor = color;
  toast.classList.add('show');

  if (state.toastTimeout) clearTimeout(state.toastTimeout);
  state.toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 4500);
}

/* ==========================================================================
   DATA FETCHING
   ========================================================================== */

async function loadPlayerProfile(publicPlayerId, showLoading = true) {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  // Clear any existing watchdog timer
  if (state.loadingWatchdogTimer) {
    clearTimeout(state.loadingWatchdogTimer);
    state.loadingWatchdogTimer = null;
  }

  if (showLoading) {
    appEl.innerHTML = renderLoadingState('Loading Collection...');
  }

  // Safety watchdog: prevent infinite spinner if network request hangs
  state.loadingWatchdogTimer = setTimeout(() => {
    try {
      const loader = document.querySelector('.profile-loader-screen, .catalog-loader');
      if (loader) {
        renderNetworkError(publicPlayerId, 'The server took too long to respond. Please check your connection or try again.');
      }
    } catch (_) {}
  }, 12000);

  try {
    const res = await fetch(`/api/public/players/${encodeURIComponent(publicPlayerId)}`);

    if (state.loadingWatchdogTimer) {
      clearTimeout(state.loadingWatchdogTimer);
      state.loadingWatchdogTimer = null;
    }

    if (res.status === 404) {
      try { closeSse(); } catch (_) {}
      renderProfileNotFound(publicPlayerId);
      return;
    }

    if (res.status >= 500 || !res.ok) {
      try { closeSse(); } catch (_) {}
      renderServerError(publicPlayerId, 'The collection database is temporarily unavailable. Please try again in a few moments.');
      return;
    }

    const data = await res.json();
    state.player = data.player;
    state.stats = data.stats;
    state.recentActivity = data.recentActivity || [];

    renderProfileShell();
    loadCurrentTab();
    setupSse(publicPlayerId);
  } catch (err) {
    if (state.loadingWatchdogTimer) {
      clearTimeout(state.loadingWatchdogTimer);
      state.loadingWatchdogTimer = null;
    }
    try { closeSse(); } catch (_) {}
    renderNetworkError(publicPlayerId, 'Unable to connect to the collection server. Please check your internet connection.');
  }
}

function loadCurrentTab() {
  if (state.activeTab === 'overview') {
    renderOverviewTab();
  } else if (state.activeTab === 'achievements') {
    loadAchievements(state.publicPlayerId);
  } else {
    loadCollectionCategory(state.publicPlayerId, state.activeTab);
  }
  updateActiveTabButton();
}

async function loadCollectionCategory(publicPlayerId, category, showLoading = true) {
  const tabContent = document.getElementById('tab-content');
  if (showLoading && tabContent) {
    tabContent.innerHTML = renderLoadingState(`Loading ${category} catalog...`);
  }

  const { rarity, status, sort, search } = state.filters;
  let url = `/api/public/players/${publicPlayerId}/collection?category=${category}&sort=${sort}`;
  if (rarity !== 'all') url += `&rarity=${rarity}`;
  if (status !== 'all') url += `&status=${status}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    state.collection = data;

    renderCollectionItems(data, search);
  } catch (err) {
    if (tabContent) {
      tabContent.innerHTML = `<div class="empty-state"><h3>Failed to load items</h3><p>${err.message}</p></div>`;
    }
  }
}

async function loadAchievements(publicPlayerId, showLoading = true) {
  const tabContent = document.getElementById('tab-content');
  if (showLoading && tabContent) {
    tabContent.innerHTML = renderLoadingState('Loading badges & achievements...');
  }

  try {
    const res = await fetch(`/api/public/players/${publicPlayerId}/achievements`);
    const data = await res.json();
    state.achievements = data;

    renderAchievementsTab(data);
  } catch (err) {
    if (tabContent) {
      tabContent.innerHTML = `<div class="empty-state"><h3>Failed to load achievements</h3><p>${err.message}</p></div>`;
    }
  }
}

/* ==========================================================================
   RENDERERS — HOME PAGE
   ========================================================================== */

function renderHomePage() {
  const appEl = document.getElementById('app');
  appEl.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="brand-logo" onclick="event.preventDefault(); navigate('/');">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div><span class="brand-text-accent">COLLECTION</span></div>
        </a>
      </div>
    </header>

    <main class="container page-main">
      <div class="home-hero">
        <h1>EVERY CATCH. EVERY GEM.<br><span style="color: var(--accent-crimson);">PUBLIC SHOWCASE.</span></h1>
        <p>The companion collection viewer for Goti. Play Fishing, Mining, and Mystery Chests during YouTube livestreams and explore your inventory anytime.</p>
        
        <form id="home-search-form" class="home-search-bar" onsubmit="event.preventDefault(); window.submitHomeSearch && window.submitHomeSearch();">
          <input type="text" id="home-search-input" class="home-search-input" placeholder="Enter your YouTube username or Collection ID (usr_...)..." autocomplete="off" />
          <button type="submit" id="home-search-btn" class="home-search-btn" onclick="event.preventDefault(); window.submitHomeSearch && window.submitHomeSearch();">EXPLORE</button>
        </form>
      </div>

      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 32px; margin: 24px 0 32px;">
        <h3 style="font-size: 1.35rem; margin-bottom: 12px; color: var(--text-main);">How Collection Works</h3>
        <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px;">
          Viewers participate in chat mini-games during the stream. Type <code>!fish</code>, <code>!mine</code>, or <code>!chest</code> to discover collectibles.
          To get your personal public collection link in YouTube chat, simply type:
        </p>
        <div style="background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 18px; font-family: monospace; color: var(--accent-crimson); font-size: 1.1rem; display: inline-block;">
          !collection
        </div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 14px;">
          Note: This website is completely read-only and requires zero sign-up. Item sales are executed safely through chat commands handled by Goti.
        </p>
      </div>
    </main>

    <!-- Watermark Footer -->
    <footer class="site-watermark">
      <span>made with <span class="heart-icon">❤️</span> by <strong>acrone</strong></span>
    </footer>
  `;
}

/* ==========================================================================
   RENDERERS — PROFILE SHELL & STATS
   ========================================================================== */

function renderProfileShell() {
  const { player, stats } = state;
  const appEl = document.getElementById('app');

  const avatarMarkup = player.avatarUrl
    ? `<img src="${player.avatarUrl}" class="profile-avatar" alt="${player.displayName}" onerror="this.onerror=null; this.src='/assets/items/fallback_item.svg';"/>`
    : `<div class="avatar-fallback">${player.displayName.charAt(0).toUpperCase()}</div>`;

  appEl.innerHTML = `
    <!-- Sticky Navigation Header -->
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="brand-logo" onclick="event.preventDefault(); navigate('/');">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div><span class="brand-text-accent">COLLECTION</span></div>
        </a>

        <div class="header-status-badge" id="sse-indicator">
          <span class="pulse-dot"></span> Live Sync Active
        </div>
      </div>
    </header>

    <main class="container page-main">
      <!-- Profile Hero Banner -->
      <section class="profile-hero">
        <div class="profile-identity">
          <div class="profile-avatar-wrap">
            ${avatarMarkup}
          </div>
          <div class="profile-meta">
            <h1>${escapeHtml(player.displayName)}</h1>
            <div class="profile-role-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              ${player.titleBadge || 'Collector'}
            </div>
          </div>
        </div>

        <div class="profile-actions">
          <div class="profile-balance-widget">
            <span class="balance-badge-label">BALANCE</span>
            <span class="balance-badge-val" id="hero-balance-val">${Number(player.balance || 0).toLocaleString()}</span>
          </div>
          <button class="btn-action" onclick="copyProfileLink()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span id="copy-btn-text">Share Profile</span>
          </button>
        </div>
      </section>

      <!-- Overview Stats Grid -->
      <section class="stats-grid" id="stats-grid-container">
        <!-- Rendered by updateStatsDom() -->
      </section>

      <!-- Tabs Navigation -->
      <nav class="tabs-nav" id="category-tabs">
        <button class="tab-btn" data-tab="overview" onclick="switchTab('overview')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          Overview
        </button>
        <button class="tab-btn" data-tab="fish" onclick="switchTab('fish')">
          🐟 Fish Collection
          <span class="tab-count" id="fish-tab-count">${stats.categories.fish.discovered}/${stats.categories.fish.total}</span>
        </button>
        <button class="tab-btn" data-tab="mining" onclick="switchTab('mining')">
          ⛏️ Mining Collection
          <span class="tab-count" id="mining-tab-count">${stats.categories.mining.discovered}/${stats.categories.mining.total}</span>
        </button>
        <button class="tab-btn" data-tab="chest" onclick="switchTab('chest')">
          📦 Mystery Chest Finds
          <span class="tab-count" id="chest-tab-count">${stats.categories.chest.discovered}/${stats.categories.chest.total}</span>
        </button>
        <button class="tab-btn" data-tab="achievements" onclick="switchTab('achievements')">
          🏆 Achievements
        </button>
      </nav>

      <!-- Tab Content Area -->
      <section id="tab-content">
        <!-- Injected dynamically -->
      </section>
    </main>

    <!-- Item Detail Modal -->
    <div class="modal-overlay" id="item-modal" onclick="closeModalOnBackdrop(event)">
      <div class="modal-box" id="modal-box"></div>
    </div>
  `;

  updateStatsDom();
  updateSseIndicator();
}

function updateStatsDom() {
  const container = document.getElementById('stats-grid-container');
  if (!container || !state.stats) return;

  const { totalQuantity, uniqueItemTypes, overallCompletionPercentage, categories } = state.stats;

  container.innerHTML = `
    <!-- Public Player Balance -->
    <div class="stat-card balance-stat-card">
      <div class="stat-header">
        <span class="stat-label">BALANCE</span>
        <span class="stat-icon">🪙</span>
      </div>
      <div class="stat-value" id="stats-balance-val">${Number(state.player?.balance || 0).toLocaleString()}</div>
      <div class="stat-subtext">
        <span>Verified Public Balance</span>
      </div>
    </div>

    <!-- Total Unique Item Types -->
    <div class="stat-card">
      <div class="stat-header">
        <span class="stat-label">Unique Discoveries</span>
        <span class="stat-icon">✨</span>
      </div>
      <div class="stat-value">${uniqueItemTypes}</div>
      <div class="stat-progress-bar">
        <div class="stat-progress-fill crimson" style="width: ${Math.min(100, (uniqueItemTypes / (categories.fish.total + categories.mining.total + categories.chest.total)) * 100)}%;"></div>
      </div>
      <div class="stat-subtext">
        <span>Distinct types owned</span>
        <span>Total Qty: ${totalQuantity}</span>
      </div>
    </div>

    <!-- Fish Collection -->
    <div class="stat-card" style="cursor: pointer;" onclick="switchTab('fish')">
      <div class="stat-header">
        <span class="stat-label">Fish Catalogue</span>
        <span class="stat-icon">🎣</span>
      </div>
      <div class="stat-value">${categories.fish.discovered} <span style="font-size: 1rem; color: var(--text-muted); font-weight: normal;">/ ${categories.fish.total}</span></div>
      <div class="stat-progress-bar">
        <div class="stat-progress-fill blue" style="width: ${categories.fish.completionPercentage}%;"></div>
      </div>
      <div class="stat-subtext">
        <span>${categories.fish.completionPercentage}% complete</span>
        <span style="color: #60A5FA;">View Fish &rarr;</span>
      </div>
    </div>

    <!-- Mining Collection -->
    <div class="stat-card" style="cursor: pointer;" onclick="switchTab('mining')">
      <div class="stat-header">
        <span class="stat-label">Mining Minerals</span>
        <span class="stat-icon">💎</span>
      </div>
      <div class="stat-value">${categories.mining.discovered} <span style="font-size: 1rem; color: var(--text-muted); font-weight: normal;">/ ${categories.mining.total}</span></div>
      <div class="stat-progress-bar">
        <div class="stat-progress-fill emerald" style="width: ${categories.mining.completionPercentage}%;"></div>
      </div>
      <div class="stat-subtext">
        <span>${categories.mining.completionPercentage}% complete</span>
        <span style="color: #34D399;">View Mining &rarr;</span>
      </div>
    </div>

    <!-- Mystery Chests -->
    <div class="stat-card" style="cursor: pointer;" onclick="switchTab('chest')">
      <div class="stat-header">
        <span class="stat-label">Chest Curiosities</span>
        <span class="stat-icon">🗝️</span>
      </div>
      <div class="stat-value">${categories.chest.discovered} <span style="font-size: 1rem; color: var(--text-muted); font-weight: normal;">/ ${categories.chest.total}</span></div>
      <div class="stat-progress-bar">
        <div class="stat-progress-fill amber" style="width: ${categories.chest.completionPercentage}%;"></div>
      </div>
      <div class="stat-subtext">
        <span>${categories.chest.completionPercentage}% complete</span>
        <span style="color: #FBBF24;">View Chests &rarr;</span>
      </div>
    </div>
  `;

  // Update tab counters
  const fishCount = document.getElementById('fish-tab-count');
  if (fishCount) fishCount.textContent = `${categories.fish.discovered}/${categories.fish.total}`;
  const miningCount = document.getElementById('mining-tab-count');
  if (miningCount) miningCount.textContent = `${categories.mining.discovered}/${categories.mining.total}`;
  const chestCount = document.getElementById('chest-tab-count');
  if (chestCount) chestCount.textContent = `${categories.chest.discovered}/${categories.chest.total}`;
}

function updateActiveTabButton() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-tab') === state.activeTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

window.switchTab = function(tabName) {
  state.activeTab = tabName;
  const path = tabName === 'overview' ? `/u/${state.publicPlayerId}` : `/u/${state.publicPlayerId}/${tabName}`;
  window.history.pushState({}, '', path);
  updateActiveTabButton();
  loadCurrentTab();
};

/* ==========================================================================
   RENDERERS — OVERVIEW TAB
   ========================================================================== */

function renderOverviewTab() {
  const tabContent = document.getElementById('tab-content');
  if (!tabContent) return;

  const { stats, recentActivity } = state;

  const recentListMarkup = (recentActivity && recentActivity.length > 0)
    ? recentActivity.map(act => {
        const isFound = act.eventType === 'found';
        const deltaStr = isFound ? `+${act.quantityDelta}` : `${act.quantityDelta}`;
        const timeAgo = formatTimeAgo(act.occurredAt);

        return `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${act.item.imageUrl}" style="width: 40px; height: 40px; border-radius: 6px; border: 1px solid ${act.item.rarity.color};" onerror="this.src='/assets/items/fallback_item.svg'"/>
              <div>
                <div style="font-weight: 700; font-size: 0.95rem; color: #F4F4F6;">${escapeHtml(act.item.name)}</div>
                <div style="font-size: 0.75rem; color: ${act.item.rarity.color}; text-transform: uppercase;">${act.item.rarity.name} · ${act.source}</div>
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-weight: 700; color: ${isFound ? '#10B981' : '#EF4444'}; font-size: 0.95rem;">${deltaStr}</span>
              <div style="font-size: 0.7rem; color: var(--text-muted);">${timeAgo}</div>
            </div>
          </div>
        `;
      }).join('')
    : `<div style="color: var(--text-muted); font-size: 0.9rem; padding: 20px 0;">No recent collection activity yet.</div>`;

  tabContent.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr; gap: 24px;">
      <!-- Overall Progress Summary -->
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <h3 style="font-size: 1.3rem;">Master Collection Progress</h3>
          <span style="font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; color: var(--accent-crimson);">${stats.overallCompletionPercentage}%</span>
        </div>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
          Calculated across all ${stats.categories.fish.total + stats.categories.mining.total + stats.categories.chest.total} active game collectibles. Selling your final copy of an item will dynamically update progress.
        </p>
        <div class="stat-progress-bar" style="height: 10px;">
          <div class="stat-progress-fill crimson" style="width: ${stats.overallCompletionPercentage}%;"></div>
        </div>
      </div>

      <!-- Recent Collection Activity Feed -->
      <div style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;">
        <h3 style="font-size: 1.25rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          Recent Activity
        </h3>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${recentListMarkup}
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   RENDERERS — COLLECTION ITEMS GRID & TOOLBAR
   ========================================================================== */

function renderCollectionItems(collectionData, searchQuery = '') {
  const tabContent = document.getElementById('tab-content');
  if (!tabContent) return;

  const { category, summary, items } = collectionData;

  // Filter in client for instant search
  let displayItems = items;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    displayItems = displayItems.filter(i => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }

  const itemsGridMarkup = displayItems.length > 0
    ? displayItems.map(item => {
        const isDiscovered = item.isDiscovered;
        const cardClass = isDiscovered ? 'item-card discovered' : 'item-card undiscovered';
        const qtyMarkup = isDiscovered
          ? `<span class="qty-badge">×${item.quantity}</span>`
          : `<span class="qty-badge" style="opacity:0.6;">Locked</span>`;

        return `
          <div class="${cardClass}" style="--rarity-color: ${item.rarityColor};" onclick="openItemModal('${item.id}')">
            <div class="item-art-wrap">
              <img src="${item.imageUrl}" class="item-art-img" alt="${item.name}" loading="lazy" onerror="this.src='/assets/items/fallback_item.svg';"/>
              ${qtyMarkup}
              ${!isDiscovered ? '<div class="lock-overlay"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></div>' : ''}
            </div>
            <div class="item-info">
              <div class="item-header">
                <span class="item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 2px;">
                <span class="rarity-pill" style="color: ${item.rarityColor}; border-color: ${item.rarityColor};">${item.rarityName}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${item.category}</span>
              </div>
              <p class="item-desc">${isDiscovered ? escapeHtml(item.description) : 'Undiscovered item. Play chat games to discover this collectible.'}</p>
            </div>
          </div>
        `;
      }).join('')
    : `<div class="empty-state" style="grid-column: 1 / -1;">
        <h3>No Collectibles Found</h3>
        <p>No items match your active search or filters. Try resetting the filters above.</p>
       </div>`;

  // If toolbar and search input already exist, update only grid to preserve user input focus
  const existingGrid = document.getElementById('items-grid-container');
  const countDisplay = document.getElementById('items-count-display');
  if (existingGrid && document.getElementById('item-search-input')) {
    existingGrid.innerHTML = itemsGridMarkup;
    if (countDisplay) countDisplay.textContent = displayItems.length;
    return;
  }

  tabContent.innerHTML = `
    <!-- Toolbar Controls -->
    <div class="toolbar-wrap">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="item-search-input" placeholder="Search by item name..." value="${escapeHtml(state.filters.search)}" oninput="handleSearchInput(this.value)" />
      </div>

      <!-- Rarity Filters -->
      <div class="filter-group">
        <button class="filter-pill ${state.filters.rarity === 'all' ? 'active' : ''}" onclick="setRarityFilter('all')">All</button>
        <button class="filter-pill ${state.filters.rarity === 'common' ? 'active' : ''}" onclick="setRarityFilter('common')">Common</button>
        <button class="filter-pill ${state.filters.rarity === 'uncommon' ? 'active' : ''}" onclick="setRarityFilter('uncommon')">Uncommon</button>
        <button class="filter-pill ${state.filters.rarity === 'rare' ? 'active' : ''}" onclick="setRarityFilter('rare')">Rare</button>
        <button class="filter-pill ${state.filters.rarity === 'epic' ? 'active' : ''}" onclick="setRarityFilter('epic')">Epic</button>
        <button class="filter-pill ${state.filters.rarity === 'legendary' ? 'active' : ''}" onclick="setRarityFilter('legendary')">Legendary</button>
        <button class="filter-pill ${state.filters.rarity === 'mythic' ? 'active' : ''}" onclick="setRarityFilter('mythic')">Mythic</button>
      </div>

      <!-- Discovery & Sorting -->
      <div style="display: flex; gap: 8px;">
        <select class="sort-select" onchange="setStatusFilter(this.value)">
          <option value="all" ${state.filters.status === 'all' ? 'selected' : ''}>All Discovery</option>
          <option value="discovered" ${state.filters.status === 'discovered' ? 'selected' : ''}>Discovered Only</option>
          <option value="undiscovered" ${state.filters.status === 'undiscovered' ? 'selected' : ''}>Undiscovered Only</option>
        </select>

        <select class="sort-select" onchange="setSortOrder(this.value)">
          <option value="rarity" ${state.filters.sort === 'rarity' ? 'selected' : ''}>Sort by Rarity</option>
          <option value="quantity" ${state.filters.sort === 'quantity' ? 'selected' : ''}>Sort by Quantity</option>
          <option value="name" ${state.filters.sort === 'name' ? 'selected' : ''}>Sort by Name</option>
        </select>
      </div>
    </div>

    <!-- Category Progress Strip -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 0 4px;">
      <span style="font-size: 0.9rem; color: var(--text-secondary);">
        Showing <strong style="color: var(--text-main);" id="items-count-display">${displayItems.length}</strong> items (${summary.discovered} discovered / ${summary.total} total in catalogue)
      </span>
      <span style="font-size: 0.85rem; font-weight: 700; color: var(--accent-crimson);">${summary.completionPercentage}% Complete</span>
    </div>

    <!-- Cards Grid -->
    <div class="items-grid" id="items-grid-container">
      ${itemsGridMarkup}
    </div>
  `;
}

window.handleSearchInput = function(val) {
  state.filters.search = val;
  if (state.collection) {
    renderCollectionItems(state.collection, val);
  }
};

window.setRarityFilter = function(rarity) {
  state.filters.rarity = rarity;
  loadCollectionCategory(state.publicPlayerId, state.activeTab);
};

window.setStatusFilter = function(status) {
  state.filters.status = status;
  loadCollectionCategory(state.publicPlayerId, state.activeTab);
};

window.setSortOrder = function(sort) {
  state.filters.sort = sort;
  loadCollectionCategory(state.publicPlayerId, state.activeTab);
};

/* ==========================================================================
   RENDERERS — ACHIEVEMENTS TAB
   ========================================================================== */

function renderAchievementsTab(data) {
  const tabContent = document.getElementById('tab-content');
  if (!tabContent) return;

  const { unlockedCount, totalCount, achievements } = data;

  const cardsMarkup = achievements.map(ach => {
    const isUnlocked = ach.isUnlocked;
    const cardClass = isUnlocked ? 'achievement-card unlocked' : 'achievement-card locked';
    const dateStr = isUnlocked && ach.unlockedAt ? `Unlocked ${formatDate(ach.unlockedAt)}` : 'Locked';

    return `
      <div class="${cardClass}">
        <div class="achievement-badge-wrap">
          <img src="${ach.badgeIcon}" alt="${ach.name}" onerror="this.src='/assets/badges/fallback_badge.svg';"/>
        </div>
        <div class="achievement-details">
          <h4>${escapeHtml(ach.name)}</h4>
          <p>${escapeHtml(ach.description)}</p>
          <div class="achievement-status-tag ${isUnlocked ? 'unlocked' : 'locked'}">
            ${isUnlocked ? '✓ ' + dateStr : '🔒 Incomplete'}
          </div>
        </div>
      </div>
    `;
  }).join('');

  tabContent.innerHTML = `
    <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h3 style="font-size: 1.25rem;">Earned Badges & Titles</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">
          Badges reflect your current active inventory. If you sell items and drop below a milestone, badges can be revoked automatically by the bot.
        </p>
      </div>
      <div style="text-align: right;">
        <span style="font-family: var(--font-heading); font-size: 1.75rem; font-weight: 700; color: var(--accent-crimson);">${unlockedCount} / ${totalCount}</span>
        <div style="font-size: 0.75rem; color: var(--text-muted);">Unlocked</div>
      </div>
    </div>

    <div class="achievements-grid">
      ${cardsMarkup}
    </div>
  `;
}

/* ==========================================================================
   MODAL DIALOG (ITEM DETAIL)
   ========================================================================== */

window.openItemModal = function(itemId) {
  if (!state.collection || !state.collection.items) return;
  const item = state.collection.items.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.getElementById('item-modal');
  const box = document.getElementById('modal-box');
  if (!modal || !box) return;

  const firstFound = item.firstFoundAt ? formatDate(item.firstFoundAt) : 'Never';
  const lastFound = item.lastFoundAt ? formatDate(item.lastFoundAt) : 'Never';

  box.innerHTML = `
    <button class="modal-close-btn" onclick="closeModal()">✕</button>
    <div style="text-align: center; margin-bottom: 16px;">
      <div style="width: 120px; height: 120px; margin: 0 auto 12px; border-radius: 12px; border: 2px solid ${item.rarityColor}; overflow: hidden; background: #0E0F14; box-shadow: 0 0 20px ${item.rarityColor}40;">
        <img src="${item.imageUrl}" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.src='/assets/items/fallback_item.svg';"/>
      </div>
      <h2 style="font-size: 1.5rem; margin-bottom: 4px;">${escapeHtml(item.name)}</h2>
      <div style="display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: ${item.rarityColor}; border: 1px solid ${item.rarityColor};">
        ${item.rarityName} Tier
      </div>
    </div>

    <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; text-align: center; margin-bottom: 20px;">
      ${item.isDiscovered ? escapeHtml(item.description) : 'You have not discovered this item yet. Play chat games to find it!'}
    </p>

    <div style="background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px; font-size: 0.85rem; display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Current Quantity Owned:</span>
        <strong style="color: #F4F4F6;">×${item.quantity}</strong>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Game Category:</span>
        <span style="color: #F4F4F6; text-transform: capitalize;">${item.category}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Discovery Status:</span>
        <span style="color: ${item.isDiscovered ? '#10B981' : '#777782'}; font-weight: 600;">${item.isDiscovered ? 'Discovered' : 'Locked'}</span>
      </div>
      ${item.isDiscovered ? `
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">First Discovered:</span>
        <span style="color: #F4F4F6;">${firstFound}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--text-muted);">Last Discovered:</span>
        <span style="color: #F4F4F6;">${lastFound}</span>
      </div>
      ` : ''}
    </div>
  `;

  modal.classList.add('open');
};

window.closeModal = function() {
  const modal = document.getElementById('item-modal');
  if (modal) modal.classList.remove('open');
};

window.closeModalOnBackdrop = function(e) {
  if (e.target.id === 'item-modal') {
    closeModal();
  }
};

/* ==========================================================================
   HELPERS & UTILITIES
   ========================================================================== */

window.copyProfileLink = function() {
  const url = window.location.origin + `/u/${state.publicPlayerId}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      const btnText = document.getElementById('copy-btn-text');
      if (btnText) {
        btnText.textContent = 'Copied Link!';
        setTimeout(() => { btnText.textContent = 'Share Profile'; }, 2000);
      }
      showToast('Profile Link Copied', 'Public collection link copied to clipboard.', '#D83C53');
    }).catch(() => {
      showToast('Profile Link', url, '#D83C53');
    });
  } else {
    showToast('Profile Link', url, '#D83C53');
  }
};

function renderLoadingState(message) {
  return `
    <div style="text-align: center; padding: 60px 20px;">
      <div class="pulse-dot" style="margin: 0 auto 16px; width: 14px; height: 14px; background: var(--accent-crimson);"></div>
      <div style="color: var(--text-secondary); font-size: 0.95rem;">${message}</div>
    </div>
  `;
}

function renderProfileNotFound(attemptedId) {
  const appEl = document.getElementById('app');
  const targetLabel = attemptedId ? `<div class="not-found-target">Player: <span class="target-id-badge">${escapeHtml(attemptedId)}</span></div>` : '';

  appEl.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="brand-logo" onclick="event.preventDefault(); navigate('/');">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div><span class="brand-text-accent">COLLECTION</span></div>
        </a>
      </div>
    </header>

    <main class="not-found-wrapper">
      <div class="not-found-card">
        <!-- Missing profile illustration with gaming esports motif -->
        <div class="not-found-icon-wrap">
          <svg width="84" height="84" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="42" cy="42" r="40" stroke="#D83C53" stroke-width="2" stroke-dasharray="5 5" stroke-opacity="0.6"/>
            <circle cx="42" cy="42" r="33" fill="rgba(216, 60, 83, 0.08)"/>
            <circle cx="42" cy="31" r="11" stroke="#D83C53" stroke-width="2.5" fill="none"/>
            <path d="M24 59C24 49.5 32 45 42 45C52 45 60 49.5 60 59" stroke="#D83C53" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="58" cy="26" r="9" fill="#D83C53"/>
            <path d="M56.5 24C56.5 23.2 57.2 22.5 58 22.5C58.8 22.5 59.5 23.2 59.5 24C59.5 25 58 25.8 58 26.6M58 28.5V29" stroke="#FFF" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>

        <div>
          <span class="not-found-pill">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            UNREGISTERED PLAYER
          </span>
        </div>

        <h1 class="not-found-title">PROFILE NOT FOUND</h1>
        ${targetLabel}
        <h2 class="not-found-subheading">This collection profile doesn't exist yet.</h2>

        <p class="not-found-desc">
          Looks like this player hasn't registered their collection profile yet.<br>
          Want to see their collection? Ask them to join the stream and type the following command in the stream chat:
        </p>

        <!-- Command Box -->
        <div class="command-box">
          <div class="command-box-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            YouTube Stream Chat Command
          </div>
          <div class="command-box-content">
            <span class="command-code">!collection</span>
            <button type="button" class="btn-copy-command" onclick="copyChatCommand(this)" title="Copy command to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>COPY</span>
            </button>
          </div>
          <div class="command-box-hint">
            The command will help them get their public collection profile link.
          </div>
        </div>

        <!-- Future Note Callout -->
        <div class="not-found-future-note">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
          <span>Once their profile is available, you'll be able to explore their collection, rare items, achievements and progress.</span>
        </div>

        <!-- Action Buttons -->
        <div class="not-found-actions">
          <button type="button" class="btn-primary-action" onclick="navigate('/')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Back to Collection
          </button>
          <button type="button" class="btn-secondary-action" onclick="retryLoadProfile('${escapeHtml(attemptedId)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Try Again
          </button>
        </div>
      </div>
    </main>
  `;
}

function renderServerError(attemptedId, message) {
  const appEl = document.getElementById('app');
  const targetLabel = attemptedId ? `<div class="not-found-target">Target: <span class="target-id-badge">${escapeHtml(attemptedId)}</span></div>` : '';

  appEl.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="brand-logo" onclick="event.preventDefault(); navigate('/');">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div><span class="brand-text-accent">COLLECTION</span></div>
        </a>
      </div>
    </header>

    <main class="not-found-wrapper">
      <div class="not-found-card server-error">
        <div class="not-found-icon-wrap">
          <svg width="84" height="84" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="42" cy="42" r="40" stroke="#F59E0B" stroke-width="2" stroke-dasharray="5 5" stroke-opacity="0.6"/>
            <circle cx="42" cy="42" r="33" fill="rgba(245, 158, 11, 0.08)"/>
            <path d="M42 26V46M42 54V56" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </div>

        <div>
          <span class="not-found-pill pill-warning">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            DATABASE TEMPORARILY UNAVAILABLE
          </span>
        </div>

        <h1 class="not-found-title">SERVER ERROR</h1>
        ${targetLabel}
        <h2 class="not-found-subheading">Unable to fetch collection data at this time</h2>

        <p class="not-found-desc">
          ${escapeHtml(message || 'The collection database is temporarily unavailable. Your items are safe, please try again in a few moments.')}
        </p>

        <div class="not-found-actions">
          <button type="button" class="btn-primary-action" onclick="retryLoadProfile('${escapeHtml(attemptedId)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Retry Connection
          </button>
          <button type="button" class="btn-secondary-action" onclick="navigate('/')">
            Back to Collection
          </button>
        </div>
      </div>
    </main>
  `;
}

function renderNetworkError(attemptedId, message) {
  const appEl = document.getElementById('app');
  const targetLabel = attemptedId ? `<div class="not-found-target">Target: <span class="target-id-badge">${escapeHtml(attemptedId)}</span></div>` : '';

  appEl.innerHTML = `
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="brand-logo" onclick="event.preventDefault(); navigate('/');">
          <div class="brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div><span class="brand-text-accent">COLLECTION</span></div>
        </a>
      </div>
    </header>

    <main class="not-found-wrapper">
      <div class="not-found-card network-error">
        <div class="not-found-icon-wrap">
          <svg width="84" height="84" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="42" cy="42" r="40" stroke="#EF4444" stroke-width="2" stroke-dasharray="5 5" stroke-opacity="0.6"/>
            <circle cx="42" cy="42" r="33" fill="rgba(239, 68, 68, 0.08)"/>
            <line x1="28" y1="28" x2="56" y2="56" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M34 42C34 37.5 37.5 34 42 34C44.5 34 46.8 35.1 48.3 36.8" stroke="#EF4444" stroke-width="2" stroke-linecap="round"/>
            <circle cx="42" cy="52" r="2.5" fill="#EF4444"/>
          </svg>
        </div>

        <div>
          <span class="not-found-pill pill-danger">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            CONNECTION FAILED
          </span>
        </div>

        <h1 class="not-found-title">OFFLINE</h1>
        ${targetLabel}
        <h2 class="not-found-subheading">Unable to connect to collection server</h2>

        <p class="not-found-desc">
          ${escapeHtml(message || 'Please check your internet connection or verify your network access.')}
        </p>

        <div class="not-found-actions">
          <button type="button" class="btn-primary-action" onclick="retryLoadProfile('${escapeHtml(attemptedId)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Try Again
          </button>
          <button type="button" class="btn-secondary-action" onclick="navigate('/')">
            Back to Collection
          </button>
        </div>
      </div>
    </main>
  `;
}

function renderNotFound(msg) {
  renderProfileNotFound(msg);
}

window.copyChatCommand = function(btnEl) {
  const text = '!collection';
  const onSuccess = () => {
    if (btnEl) {
      btnEl.classList.add('copied');
      const span = btnEl.querySelector('span');
      if (span) span.textContent = 'COPIED!';
      setTimeout(() => {
        btnEl.classList.remove('copied');
        if (span) span.textContent = 'COPY';
      }, 2000);
    }
    showToast('Command Copied', 'Paste !collection in YouTube stream chat to register your profile link.', '#10B981');
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); onSuccess(); } catch (e) {}
      document.body.removeChild(ta);
    });
  } else {
    onSuccess();
  }
};

window.retryLoadProfile = function(identifier) {
  if (!identifier) {
    navigate('/', true);
    return;
  }
  loadPlayerProfile(identifier, true);
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Launch application once all components, routes, and listeners are fully initialized
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
