const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const FORMATS = ['modern', 'standard', 'pioneer', 'legacy', 'pauper'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};

async function scrapeMetagame(format) {
  const url = `https://www.mtggoldfish.com/metagame/${format}/full#online`;
  const { data } = await axios.get(url, { headers: HEADERS });
  const $ = cheerio.load(data);
  const decks = [];

  $('.archetype-tile').each((i, el) => {
    const name = $(el).find('.archetype-tile-title a').first().text().trim();
    const shareText = $(el).find('.percentage').first().text().trim();
    const share = parseFloat(shareText.replace('%', '')) || 0;
    const link = $(el).find('.archetype-tile-title a').attr('href');
    if (name && share) {
      decks.push({ name, share, link: 'https://www.mtggoldfish.com' + link });
    }
  });

  if (decks.length === 0) {
    $('.metagame-list-item').each((i, el) => {
      const name = $(el).find('a').first().text().trim();
      const shareText = $(el).find('.percentage, .share').first().text().trim();
      const share = parseFloat(shareText.replace('%', '')) || 0;
      const link = $(el).find('a').attr('href');
      if (name && share) {
        decks.push({ name, share, link: 'https://www.mtggoldfish.com' + link });
      }
    });
  }

  return decks.sort((a, b) => b.share - a.share).slice(0, 12);
}

async function scrapeDeckCards(deckUrl) {
  const { data } = await axios.get(deckUrl, { headers: HEADERS });
  const $ = cheerio.load(data);
  const cards = [];

  $('.deck-view-deck-table tr').each((i, el) => {
    const qty = parseInt($(el).find('td').first().text().trim()) || 0;
    const name = $(el).find('.deck-col-card a').first().text().trim();
    if (name && qty && !$(el).closest('.sideboard').length) {
      for (let j = 0; j < Math.min(qty, 4); j++) cards.push(name);
    }
  });

  return cards.slice(0, 60);
}

let cache = {};
let cacheTime = {};

app.get('/metagame/:format', async (req, res) => {
  const format = req.params.format;
  if (!FORMATS.includes(format)) return res.status(400).json({ error: 'Invalid format' });

  const now = Date.now();
  if (cache[format] && now - cacheTime[format] < 3600000) {
    return res.json(cache[format]);
  }

  try {
    const decks = await scrapeMetagame(format);
    cache[format] = decks;
    cacheTime[format] = now;
    res.json(decks);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'Failed to fetch metagame data', details: e.message });
  }
});

app.get('/deck', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes('mtggoldfish.com')) return res.status(400).json({ error: 'Invalid URL' });

  try {
    const cards = await scrapeDeckCards(url);
    res.json({ cards });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch deck', details: e.message });
  }
});

app.get('/debug', async (req, res) => {
  try {
    const { data } = await axios.get('https://www.mtggoldfish.com/metagame/modern/full#online', { headers: HEADERS });
    res.send(data.substring(0, 2000));
  } catch(e) {
    res.status(500).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));