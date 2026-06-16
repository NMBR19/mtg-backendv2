const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const FORMATS = ['modern','standard','pioneer','legacy','pauper'];
const SCRAPER_KEY = '3f10d92a56b446be501edab3d505fcae';

function scraperUrl(url) {
  return `https://api.scraperapi.com/?api_key=${SCRAPER_KEY}&render=true&url=${encodeURIComponent(url)}`;
}

app.get('/debug', async (req, res) => {
  try {
    const url = scraperUrl('https://www.mtggoldfish.com/metagame/modern/full');
    const { data } = await axios.get(url, { timeout: 60000 });
    res.send(data.substring(0, 3000));
  } catch(e) {
    res.status(500).send(e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
