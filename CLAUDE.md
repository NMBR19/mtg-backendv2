# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # run server (node server.js)
```

No test suite or linter is configured. Run the server and hit endpoints manually to verify changes.

## Architecture

Single-file Express server (`server.js`) that proxies requests to MTG Goldfish through ScraperAPI.

**Why ScraperAPI**: MTG Goldfish requires JavaScript rendering; ScraperAPI handles that via `render=true`.

**Key constants**:
- `SCRAPER_KEY` — hardcoded ScraperAPI key (treat as a secret; move to `process.env.SCRAPER_API_KEY` before deploying)
- `FORMATS` — `['modern','standard','pioneer','legacy','pauper']` — defined but not yet wired to any endpoint
- Port defaults to `3000` or `process.env.PORT`

**Current endpoints**:
- `GET /debug` — fetches the Modern metagame page via ScraperAPI and returns the first 3000 chars of raw HTML (diagnostic only)

**Planned work** (implied by `FORMATS` array and cheerio dependency): parse metagame data per format and return structured JSON. Cheerio is installed for HTML parsing but not yet used.
