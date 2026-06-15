const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const FORMATS = ['modern', 'standard', 'pioneer', 'legacy', 'pauper'];

async function scrapeMetagame(format) {
  const url = `https://www.mtggoldfish.com/metagame/${format}/full#online`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
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

  return decks.sort((a, b) => b.share - a.share).slice(0, 12);
}

async function scrapeDeckCards(deckUrl) {
  const { data } = await axios.get(deckUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
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
    res.status(500).json({ error: 'Failed to fetch metagame data' });
  }
});

app.get('/deck', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.includes('mtggoldfish.com')) return res.status(400).json({ error: 'Invalid URL' });

  try {
    const cards = await scrapeDeckCards(url);
    res.json({ cards });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch deck' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));