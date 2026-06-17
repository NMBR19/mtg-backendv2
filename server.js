const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const FORMATS = ['modern', 'standard', 'pioneer', 'legacy', 'pauper'];

const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
const db = new Database('./data/votes.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL,
    vote TEXT NOT NULL CHECK(vote IN ('keep', 'mull')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_hand_id ON votes(hand_id);

  CREATE TABLE IF NOT EXISTS daily_cache (
    date TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

const cache = {
  metagame: {},
  decklists: {},
};
const METAGAME_TTL = 3 * 60 * 60 * 1000;
const DECKLIST_TTL = 24 * 60 * 60 * 1000;

let browser = null;
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

// Fetch a page using a real browser. Waits for a CSS selector if provided,
// otherwise falls back to a short fixed wait.
async function fetchPage(url, readySelector = null) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (readySelector) {
      await page.waitForSelector(readySelector, { timeout: 10000 }).catch(() => {});
    } else {
      await page.waitForTimeout(1000);
    }
    return await page.content();
  } finally {
    await context.close();
  }
}

async function getMetagameDecks(format) {
  const cached = cache.metagame[format];
  if (cached && Date.now() - cached.timestamp < METAGAME_TTL) return cached.decks;

  console.log(`[metagame] fetching ${format}...`);
  const html = await fetchPage(
    `https://www.mtggoldfish.com/metagame/${format}/full`,
    '.archetype-tile'
  );
  const $ = cheerio.load(html);

  const decks = [];
  $('.archetype-tile').each((_, el) => {
    const a = $(el).find('.archetype-tile-title a').first();
    const name = a.text().trim();
    const href = a.attr('href');
    if (name && href) {
      decks.push({ name, url: `https://www.mtggoldfish.com${href}` });
    }
  });

  console.log(`[metagame] found ${decks.length} decks for ${format}`);
  cache.metagame[format] = { decks, timestamp: Date.now() };
  return decks;
}

// Returns { companion: string[], main: string[], side: string[] }
function parseTextDecklist(text) {
  const companion = [];
  const main = [];
  const side = [];
  let section = 'main';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Section headers with or without // prefix
    const header = trimmed.replace(/^\/\/\s*/, '').toLowerCase();
    if (header === 'companion')                           { section = 'companion'; continue; }
    if (header === 'deck' || header === 'main deck')      { section = 'main';      continue; }
    if (header === 'sideboard' || header === 'side board'){ section = 'side';      continue; }

    const m = trimmed.match(/^(\d+)\s+(.+?)(\s*\/\/.*)?$/);
    if (m) {
      const qty = parseInt(m[1]);
      const name = m[2].trim();
      const arr = section === 'companion' ? companion : section === 'side' ? side : main;
      for (let i = 0; i < qty; i++) arr.push(name);
    }
  }
  return { companion, main, side };
}

// Returns { main: string[], side: string[] }
async function getDeckList(deckUrl) {
  const cached = cache.decklists[deckUrl];
  if (cached && Date.now() - cached.timestamp < DECKLIST_TTL) return cached.cards;

  console.log(`[decklist] fetching ${deckUrl}...`);
  const html = await fetchPage(deckUrl, 'textarea, .deck-view-deck-table');
  const $ = cheerio.load(html);

  let companion = [];
  let main = [];
  let side = [];
  let found = false;

  // Strategy 1: textarea with text-format decklist
  $('textarea').each((_, el) => {
    const text = $(el).val() || $(el).text();
    if (text && text.match(/^\d+\s+\S/m)) {
      const parsed = parseTextDecklist(text);
      if (parsed.main.length >= 7) {
        ({ companion, main, side } = parsed);
        found = true;
        return false;
      }
    }
  });

  // Strategy 2: deck table rows
  if (!found) {
    let section = 'main';
    $('.deck-view-deck-table tr, table.deck-simple tr').each((_, row) => {
      const rowText = $(row).text().trim().toLowerCase();
      // Use startsWith so headers like "Sideboard (15 cards)" also match
      if (rowText.startsWith('companion')) { section = 'companion'; return; }
      if (rowText.startsWith('sideboard')) { section = 'side'; return; }
      const qtyText = $(row).find('.deck-col-qty').first().text().trim();
      const name = $(row).find('.deck-col-card a').first().text().trim();
      const qty = parseInt(qtyText);
      if (!isNaN(qty) && qty > 0 && name) {
        const arr = section === 'companion' ? companion : section === 'side' ? side : main;
        for (let i = 0; i < qty; i++) arr.push(name);
      }
    });
    if (main.length >= 7) found = true;
  }

  // Strategy 3: generic table
  if (!found) {
    let section = 'main';
    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;
      const first = cells.eq(0).text().trim();
      // Prefer the first link's text to avoid concatenated cell text (e.g. deck name repeated)
      const second = (cells.eq(1).find('a').first().text().trim()) || cells.eq(1).text().trim();
      const secondLower = second.toLowerCase();
      if (secondLower.startsWith('companion')) { section = 'companion'; return; }
      if (secondLower.startsWith('sideboard')) { section = 'side';      return; }
      const qty = parseInt(first);
      // Allow up to 24 copies so basic lands (e.g. 18 Mountain in Pauper) are not filtered out
      if (!isNaN(qty) && qty > 0 && qty <= 24 && second.length > 1) {
        const arr = section === 'companion' ? companion : section === 'side' ? side : main;
        for (let i = 0; i < qty; i++) arr.push(second);
      }
    });
  }

  const result = { companion: companion.slice(0, 1), main: main.slice(0, 60), side: side.slice(0, 15) };
  console.log(`[decklist] parsed ${result.main.length} main / ${result.side.length} side`);
  cache.decklists[deckUrl] = { cards: result, timestamp: Date.now() };
  return result;
}

function groupCards(arr) {
  const map = new Map();
  for (const name of arr) map.set(name, (map.get(name) || 0) + 1);
  return Array.from(map.entries()).map(([name, qty]) => ({ name, qty }));
}

function drawHand(deck) {
  const shuffled = [...deck].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 7);
}

function makeHandId(cards, playDraw) {
  return crypto.createHash('md5').update([...cards].sort().join('|') + '|' + playDraw).digest('hex');
}

// Index one Scryfall card object into the map under every name variant.
// Pass originalName when the decklist used a different name than Scryfall knows.
function indexCard(map, card, originalName = null) {
  const img     = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
  const backImg = card.card_faces?.[1]?.image_uris?.normal ?? null;
  const entry   = { img, backImg, type: card.type_line || '' };
  const alias = (n) => { map[n] = entry; map[n.toLowerCase()] = entry; };

  if (originalName) alias(originalName);
  alias(card.name);
  if (card.name.includes(' // ')) {
    card.name.split(' // ').map(s => s.trim()).forEach(alias);
  }
  if (card.card_faces) {
    card.card_faces.forEach(f => { if (f.name) alias(f.name); });
  }
}

// Fetch image + type_line for any number of card names from Scryfall (batched at 75).
// Falls back to a fuzzy per-card lookup for any names the batch endpoint can't match
// (covers MTGA-rename, alternate printings, slight name differences, etc.).
async function fetchCardData(names) {
  const unique   = [...new Set(names)];
  const map      = {};
  const notFound = [];

  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    try {
      const { data } = await axios.post(
        'https://api.scryfall.com/cards/collection',
        { identifiers: batch.map(name => ({ name })) },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      for (const card of data.data || []) indexCard(map, card);
      for (const nf of data.not_found || []) {
        if (nf.name) notFound.push(nf.name);
      }
      console.log(`[scryfall] batch ${i/75 + 1}: ${data.data?.length ?? 0} found, ${data.not_found?.length ?? 0} not found`);
    } catch (e) {
      console.error('[scryfall] batch failed:', e.message);
    }
  }

  // Fuzzy fallback — Scryfall resolves MTGA names, alternate names, slight typos, etc.
  for (const name of notFound) {
    try {
      await new Promise(r => setTimeout(r, 100)); // respect Scryfall rate limit
      const res = await axios.get('https://api.scryfall.com/cards/named', {
        params: { fuzzy: name },
        timeout: 10000,
      });
      indexCard(map, res.data, name); // also index under the original decklist name
      console.log(`[scryfall] fuzzy resolved: "${name}" → "${res.data.name}"`);
    } catch (e) {
      console.error(`[scryfall] fuzzy failed for "${name}": ${e.response?.status ?? e.message}`);
    }
  }

  return map;
}

function cardCategory(typeLine) {
  // For MDFCs the type_line is "Front Type // Back Type" — only check the front face
  const front = (typeLine || '').split(' // ')[0].toLowerCase();
  if (front.includes('land'))     return 'Lands';
  if (front.includes('creature')) return 'Creatures';
  return 'Spells';
}

const SECTION_ORDER = ['Creatures', 'Spells', 'Lands'];

function buildDecklist(deckCards, cardDataMap) {
  function entry(name, qty) {
    const d = cardDataMap[name] || cardDataMap[name.toLowerCase()] || {};
    return { name, qty, imageUrl: d.img || null, backImageUrl: d.backImg || null };
  }

  const buckets = {};
  for (const { name, qty } of groupCards(deckCards.main)) {
    const d = cardDataMap[name] || cardDataMap[name.toLowerCase()] || {};
    const cat = cardCategory(d.type);
    (buckets[cat] = buckets[cat] || []).push(entry(name, qty));
  }

  return {
    companion: groupCards(deckCards.companion).map(({ name, qty }) => entry(name, qty)),
    groups: SECTION_ORDER
      .filter(cat => buckets[cat])
      .map(cat => ({
        label: cat,
        count: buckets[cat].reduce((s, c) => s + c.qty, 0),
        cards: buckets[cat],
      })),
    side: groupCards(deckCards.side).map(({ name, qty }) => entry(name, qty)),
  };
}

// ── Daily challenge ──
// Deterministic PRNG seeded by a number (mulberry32 algorithm)
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function todayUTCString() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dateSeed(dateStr) {
  let h = 0;
  for (const c of dateStr) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return h >>> 0;
}

let dailyCache = { date: null, data: null };

async function getDaily() {
  const today = todayUTCString();

  // 1. In-memory cache (fastest path)
  if (dailyCache.date === today && dailyCache.data) return dailyCache.data;

  // 2. Database cache — survives server restarts so the same deck+opponent+hand
  //    is served to everyone all day even if the server bounces mid-day
  const row = db.prepare('SELECT data FROM daily_cache WHERE date = ?').get(today);
  if (row) {
    const data = JSON.parse(row.data);
    dailyCache = { date: today, data };
    return data;
  }

  console.log(`[daily] computing for ${today}...`);
  const rng = mulberry32(dateSeed(today));

  // Pick a random format, then top-5 deck + opponent from that format
  const format = FORMATS[Math.floor(rng() * FORMATS.length)];
  const decks   = await getMetagameDecks(format);
  const pool    = decks.slice(0, 5);
  if (pool.length < 2) throw new Error('Not enough decks for daily');

  const deckIdx    = Math.floor(rng() * pool.length);
  const deck       = pool[deckIdx];
  const oppPool    = pool.filter((_, i) => i !== deckIdx);
  const opponent   = oppPool[Math.floor(rng() * oppPool.length)];

  const [deckData, opponentData] = await Promise.all([getDeckList(deck.url), getDeckList(opponent.url)]);
  if (deckData.main.length < 7) throw new Error('Could not parse daily decklist');

  // Deterministic Fisher-Yates shuffle → same hand for everyone all day
  const shuffled = [...deckData.main];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const hand     = shuffled.slice(0, 7);
  const playDraw = rng() < 0.5 ? 'play' : 'draw';

  const allNames = [
    ...deckData.companion, ...deckData.main, ...deckData.side,
    ...opponentData.companion, ...opponentData.main, ...opponentData.side,
  ];
  const cardDataMap = await fetchCardData(allNames);

  const data = {
    deckName: deck.name,
    format,
    playDraw,
    isDaily:   true,
    dailyDate: today,
    hand: hand.map(name => {
      const d = cardDataMap[name] || cardDataMap[name.toLowerCase()] || {};
      return { name, imageUrl: d.img || null, backImageUrl: d.backImg || null };
    }),
    handId:   makeHandId(hand, playDraw),
    decklist: buildDecklist(deckData, cardDataMap),
    opponent: { name: opponent.name, decklist: buildDecklist(opponentData, cardDataMap) },
  };

  // 3. Persist so every subsequent request — and any server restart — returns identical data
  db.prepare('INSERT OR REPLACE INTO daily_cache (date, data) VALUES (?, ?)').run(today, JSON.stringify(data));
  dailyCache = { date: today, data };
  console.log(`[daily] done — ${format} / ${deck.name}`);
  return data;
}

app.get('/api/daily', async (req, res) => {
  try {
    res.json(await getDaily());
  } catch (e) {
    console.error('[/api/daily error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/hand', async (req, res) => {
  try {
    const formatParam = req.query.format;
    const format = FORMATS.includes(formatParam) ? formatParam : FORMATS[Math.floor(Math.random() * FORMATS.length)];

    const decks = await getMetagameDecks(format);
    if (!decks.length) return res.status(503).json({ error: 'Could not fetch metagame data' });

    const pool = decks.slice(0, 20);
    const deckIndex = Math.floor(Math.random() * pool.length);
    const deck = pool[deckIndex];

    const opponentPool = pool.filter((_, i) => i !== deckIndex);
    const opponent = opponentPool[Math.floor(Math.random() * opponentPool.length)];

    const [deckData, opponentData] = await Promise.all([
      getDeckList(deck.url),
      getDeckList(opponent.url),
    ]);

    if (deckData.main.length < 7) return res.status(503).json({ error: 'Could not parse decklist', deckUrl: deck.url });

    const hand = drawHand(deckData.main);
    const playDraw = Math.random() < 0.5 ? 'play' : 'draw';
    const id = makeHandId(hand, playDraw);

    // One Scryfall call covers all cards in both decklists + hand
    const allNames = [
      ...deckData.companion, ...deckData.main, ...deckData.side,
      ...opponentData.companion, ...opponentData.main, ...opponentData.side,
    ];
    const cardDataMap = await fetchCardData(allNames);

    res.json({
      deckName: deck.name,
      format,
      playDraw,
      hand: hand.map(name => {
        const d = cardDataMap[name] || cardDataMap[name.toLowerCase()] || {};
        return { name, imageUrl: d.img || null, backImageUrl: d.backImg || null };
      }),
      handId: id,
      decklist: buildDecklist(deckData, cardDataMap),
      opponent: {
        name: opponent.name,
        decklist: buildDecklist(opponentData, cardDataMap),
      },
    });
  } catch (e) {
    console.error('[/api/hand error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vote', (req, res) => {
  const { handId, vote } = req.body;
  if (!handId || !['keep', 'mull'].includes(vote)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  db.prepare('INSERT INTO votes (hand_id, vote) VALUES (?, ?)').run(handId, vote);
  const rows = db.prepare('SELECT vote, COUNT(*) as count FROM votes WHERE hand_id = ? GROUP BY vote').all(handId);
  const result = { keep: 0, mull: 0 };
  for (const r of rows) result[r.vote] = r.count;
  result.total = result.keep + result.mull;
  res.json(result);
});

app.get('/api/votes/:handId', (req, res) => {
  const rows = db.prepare('SELECT vote, COUNT(*) as count FROM votes WHERE hand_id = ? GROUP BY vote').all(req.params.handId);
  const result = { keep: 0, mull: 0 };
  for (const r of rows) result[r.vote] = r.count;
  result.total = result.keep + result.mull;
  res.json(result);
});

app.get('/debug', async (req, res) => {
  try {
    const format = req.query.format || 'modern';
    const html = await fetchPage(`https://www.mtggoldfish.com/metagame/${format}/full`, '.archetype-tile');
    res.send(`Length: ${html.length} chars\n\n` + html.substring(0, 5000));
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

app.get('/debug/decks', async (req, res) => {
  try {
    const format = req.query.format || 'modern';
    res.json(await getMetagameDecks(format));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/debug/deck', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('?url= required');
  try {
    res.json(await getDeckList(url));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Pre-warm browser and metagame cache in the background so first request is faster
  getBrowser().then(() => {
    console.log('[startup] browser ready');
    for (const f of FORMATS) {
      getMetagameDecks(f).catch(() => {});
    }
  }).catch(() => {});
});
