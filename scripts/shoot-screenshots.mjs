// Capture a screenshot of every README-highlighted tab via headless Chromium.
// Requires: npm i -D playwright && npx playwright install chromium, with the
// frontend (5173) + backend (3001) running. Run: node scripts/shoot-screenshots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const BASE = process.env.NEXUS_URL || 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// data-tip (see src/App.jsx NAV) -> screenshot file. graph waits longer for the
// force sim to settle; others just need their API calls to land.
const TABS = [
  { tip: 'Morning digest', file: 'home.png', wait: 2200 },
  { tip: 'Job board', file: 'job-board.png', wait: 1800 },
  { tip: 'Second brain', file: 'graph.png', wait: 5500 },
  { tip: 'Research', file: 'research.png', wait: 1400 },
  { tip: 'Journal', file: 'journal.png', wait: 1400 },
  { tip: 'Goals & accountability', file: 'goals.png', wait: 1800 },
  { tip: 'Calendar', file: 'calendar.png', wait: 2000 },
  { tip: 'Council of 5', file: 'council.png', wait: 1800 },
  { tip: 'Projects', file: 'projects.png', wait: 1800 },
  { tip: 'Settings', file: 'settings.png', wait: 1800 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1512, height: 944 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(1200);

for (const t of TABS) {
  await page.click(`button.nav-btn[data-tip="${t.tip}"]`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(t.wait);
  await page.screenshot({ path: join(OUT, t.file) });
  console.log('shot', t.file);
}

await browser.close();
console.log('done — screenshots in docs/screenshots/');
