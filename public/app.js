let currentHandId = null;
let currentFormat = null;
let currentMode   = 'format'; // 'format' | 'daily'
let voted = false;

const els = {
  formatSelect:      document.getElementById('format-select'),
  playArea:          document.getElementById('play-area'),
  changeFormatBtn:   document.getElementById('change-format-btn'),
  shuffleDecksBtn:   document.getElementById('shuffle-decks-btn'),
  dailyBtn:          document.getElementById('daily-btn'),
  deckInfo:          document.getElementById('deck-info'),
  dailyBadge:        document.getElementById('daily-badge'),
  formatBadge:       document.getElementById('format-badge'),
  deckName:          document.getElementById('deck-name'),
  opponentName:      document.getElementById('opponent-name'),
  loading:           document.getElementById('loading'),
  errorState:        document.getElementById('error-state'),
  errorMsg:          document.getElementById('error-msg'),
  handDeckName:      document.getElementById('hand-deck-name'),
  hand:              document.getElementById('hand'),
  voteSection:       document.getElementById('vote-section'),
  keepBtn:           document.getElementById('keep-btn'),
  mullBtn:           document.getElementById('mull-btn'),
  resultsSection:    document.getElementById('results-section'),
  keepBar:           document.getElementById('keep-bar'),
  mullBar:           document.getElementById('mull-bar'),
  keepPct:           document.getElementById('keep-pct'),
  mullPct:           document.getElementById('mull-pct'),
  voteCount:         document.getElementById('vote-count'),
  newHandBtn:        document.getElementById('new-hand-btn'),
  decklists:         document.getElementById('decklists'),
  playerToggle:      document.getElementById('player-toggle'),
  playerDeckLabel:   document.getElementById('player-deck-label'),
  playerDecklist:    document.getElementById('player-decklist'),
  opponentToggle:    document.getElementById('opponent-toggle'),
  opponentDeckLabel: document.getElementById('opponent-deck-label'),
  opponentDecklist:  document.getElementById('opponent-decklist'),
  tooltip:           document.getElementById('card-tooltip'),
  tooltipImg:        document.getElementById('card-tooltip-img'),
  tooltipBackImg:    document.getElementById('card-tooltip-back-img'),
};

function show(...elements) { elements.forEach(el => el.classList.remove('hidden')); }
function hide(...elements) { elements.forEach(el => el.classList.add('hidden')); }

// ── Card tooltip ──
let _singleWidth = 220;
let _tooltipWidth = 220;

function showTooltip(e, imageUrl, width = 220, backImageUrl = null) {
  if (!imageUrl) return;
  _singleWidth = width;
  els.tooltipImg.src = imageUrl;
  els.tooltipImg.style.width = width + 'px';

  if (backImageUrl) {
    els.tooltipBackImg.src = backImageUrl;
    els.tooltipBackImg.style.width = width + 'px';
    els.tooltipBackImg.classList.remove('hidden');
    _tooltipWidth = width * 2 + 8;
  } else {
    els.tooltipBackImg.classList.add('hidden');
    _tooltipWidth = width;
  }

  show(els.tooltip);
  positionTooltip(e);
}

function positionTooltip(e) {
  const w = _tooltipWidth;
  const h = _singleWidth * 1.4;
  let x = e.clientX + 24;
  let y = e.clientY - h / 2;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 24;
  y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  els.tooltip.style.left = x + 'px';
  els.tooltip.style.top  = y + 'px';
}

function hideTooltip() { hide(els.tooltip); }

// ── Navigation ──
function showFormatSelect() {
  hide(els.playArea);
  show(els.formatSelect);
}

function selectFormat(format) {
  currentMode   = 'format';
  currentFormat = format;
  hide(els.formatSelect);
  show(els.playArea);
  loadFrom(`/api/hand?format=${format}`);
}

function retryHand() {
  if (currentMode === 'daily') loadFrom('/api/daily');
  else loadFrom(`/api/hand?format=${currentFormat}`);
}

function loadHand() {
  loadFrom(`/api/hand?format=${currentFormat}`);
}

function loadDaily() {
  currentMode   = 'daily';
  currentFormat = null;
  hide(els.formatSelect);
  show(els.playArea);
  loadFrom('/api/daily');
}

// ── Core loader ──
async function loadFrom(apiUrl) {
  voted = false;
  currentHandId = null;

  hide(
    els.deckInfo, els.errorState, els.handDeckName, els.hand,
    els.voteSection, els.resultsSection, els.decklists,
    els.newHandBtn, els.shuffleDecksBtn, els.dailyBadge,
  );
  show(els.loading);
  hideTooltip();

  els.hand.innerHTML = '';
  els.playerDecklist.innerHTML = '';
  els.opponentDecklist.innerHTML = '';
  els.playerToggle.classList.remove('open');
  els.playerDecklist.classList.remove('open');
  els.opponentToggle.classList.remove('open');
  els.opponentDecklist.classList.remove('open');
  els.keepBtn.disabled = false;
  els.mullBtn.disabled = false;
  els.keepBar.style.width = '0%';
  els.mullBar.style.width = '0%';

  try {
    const res  = await fetch(apiUrl);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    currentHandId = data.handId;

    // Daily badge
    if (data.isDaily) {
      const d = new Date(data.dailyDate + 'T00:00:00Z');
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      els.dailyBadge.textContent = `Daily · ${label}`;
      show(els.dailyBadge);
    }

    // Top bar
    els.formatBadge.textContent  = data.format;
    els.deckName.textContent     = data.deckName;
    els.opponentName.textContent = data.opponent.name;

    // Deck name + decklist labels
    els.handDeckName.textContent     = `${data.deckName} vs ${data.opponent.name}`;
    els.playerDeckLabel.textContent  = data.deckName;
    els.opponentDeckLabel.textContent = data.opponent.name;

    // Render hand
    for (const card of data.hand) {
      if (card.imageUrl) {
        const img = document.createElement('img');
        img.src       = card.imageUrl;
        img.alt       = card.name;
        img.title     = card.name;
        img.className = 'card';

        if (card.backImageUrl) {
          img.addEventListener('mouseenter', (e) => {
            img.src = card.backImageUrl;
            showTooltip(e, card.backImageUrl, 340);
          });
          img.addEventListener('mousemove',  positionTooltip);
          img.addEventListener('mouseleave', () => { img.src = card.imageUrl; hideTooltip(); });
        } else {
          img.addEventListener('mouseenter', (e) => showTooltip(e, card.imageUrl, 340));
          img.addEventListener('mousemove',  positionTooltip);
          img.addEventListener('mouseleave', hideTooltip);
        }

        els.hand.appendChild(img);
      } else {
        const div = document.createElement('div');
        div.className   = 'card-placeholder';
        div.textContent = card.name;
        els.hand.appendChild(div);
      }
    }

    renderDecklist(els.playerDecklist,   data.decklist);
    renderDecklist(els.opponentDecklist, data.opponent.decklist);

    hide(els.loading);
    show(els.deckInfo, els.handDeckName, els.hand, els.voteSection, els.decklists);
    if (!data.isDaily) show(els.shuffleDecksBtn);

  } catch (e) {
    hide(els.loading);
    els.errorMsg.textContent = `Something went wrong: ${e.message}`;
    show(els.errorState);
  }
}

// ── Decklist rendering ──
function renderDecklist(container, decklist) {
  container.innerHTML = '';

  if (decklist.companion?.length > 0) {
    container.appendChild(makeSectionHeader('Companion', decklist.companion.length, 'companion'));
    for (const card of decklist.companion) container.appendChild(makeDecklistItem(card));
  }

  for (const group of (decklist.groups || [])) {
    container.appendChild(makeSectionHeader(group.label, group.count));
    for (const card of group.cards) container.appendChild(makeDecklistItem(card));
  }
}

function makeSectionHeader(label, count, extraClass = '') {
  const header = document.createElement('div');
  header.className = 'decklist-section-header' + (extraClass ? ' ' + extraClass : '');
  header.innerHTML = `<span class="decklist-section-label">${label}</span><span class="decklist-section-count">${count}</span>`;
  return header;
}

function makeDecklistItem({ name, qty, imageUrl, backImageUrl }) {
  const item = document.createElement('div');
  item.className = 'decklist-item';

  const qtySpan = document.createElement('span');
  qtySpan.className   = 'decklist-qty';
  qtySpan.textContent = qty;

  const nameSpan = document.createElement('span');
  nameSpan.className   = 'decklist-name';
  nameSpan.textContent = name;

  if (imageUrl) {
    nameSpan.classList.add('hoverable');
    nameSpan.addEventListener('mouseenter', (e) => showTooltip(e, imageUrl, 385, backImageUrl || null));
    nameSpan.addEventListener('mousemove',  positionTooltip);
    nameSpan.addEventListener('mouseleave', hideTooltip);
  }

  item.appendChild(qtySpan);
  item.appendChild(nameSpan);
  return item;
}

// ── Voting ──
async function castVote(choice) {
  if (voted || !currentHandId) return;
  voted = true;
  els.keepBtn.disabled = true;
  els.mullBtn.disabled = true;

  try {
    const res = await fetch('/api/vote', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ handId: currentHandId, vote: choice }),
    });
    renderResults(await res.json());
  } catch {
    renderResults({ keep: 0, mull: 0, total: 0 });
  }
}

function renderResults(data) {
  const keepPct = data.total > 0 ? Math.round((data.keep / data.total) * 100) : 0;
  const mullPct = data.total > 0 ? 100 - keepPct : 0;

  requestAnimationFrame(() => {
    els.keepBar.style.width = keepPct + '%';
    els.mullBar.style.width = mullPct + '%';
  });

  els.keepPct.textContent  = keepPct + '%';
  els.mullPct.textContent  = mullPct + '%';
  els.voteCount.textContent = data.total === 1
    ? 'You are the first to vote on this exact hand'
    : `${data.total} votes on this exact hand`;

  hide(els.voteSection);
  show(els.resultsSection);
  if (currentMode !== 'daily') show(els.newHandBtn);
}

function toggleDecklist(toggleBtn, contentEl) {
  const isOpen = contentEl.classList.contains('open');
  contentEl.classList.toggle('open', !isOpen);
  toggleBtn.classList.toggle('open', !isOpen);
}

// ── Events ──
document.querySelectorAll('.btn-format').forEach(btn => {
  btn.addEventListener('click', () => selectFormat(btn.dataset.format));
});

els.dailyBtn.addEventListener('click',        loadDaily);
els.changeFormatBtn.addEventListener('click', showFormatSelect);
els.shuffleDecksBtn.addEventListener('click', loadHand);
els.keepBtn.addEventListener('click',         () => castVote('keep'));
els.mullBtn.addEventListener('click',         () => castVote('mull'));
els.newHandBtn.addEventListener('click',      loadHand);
els.playerToggle.addEventListener('click',    () => toggleDecklist(els.playerToggle,   els.playerDecklist));
els.opponentToggle.addEventListener('click',  () => toggleDecklist(els.opponentToggle, els.opponentDecklist));
