// ============================================================
//  Nexus demo recorder — Playwright records a short clip of each
//  README-highlighted tab, then ffmpeg converts it to a GIF in docs/gifs/.
//
//  This is dev-only tooling; it is NOT part of the app and pulls no runtime
//  deps. Prerequisites (install once, locally — intentionally NOT in
//  package.json dependencies so `npm install` stays lean):
//
//      npm i -D playwright
//      npx playwright install chromium
//      # plus ffmpeg on PATH  (macOS: brew install ffmpeg)
//
//  Then, with BOTH the frontend (5173) and backend (3001) running:
//      npm run record:demos            # all tabs below
//      npm run record:demos -- home    # one tab by id
//
//  Each tab records a new browser context (one .webm), which ffmpeg turns into
//  docs/gifs/<id>.gif. Interactions are intentionally light and easy to edit —
//  tweak the `steps` per tab to taste.
// ============================================================
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'gifs');
const BASE_URL = process.env.NEXUS_URL || 'http://localhost:5173';
const VIEWPORT = { width: 1480, height: 920 };
const FPS = 12;
const GIF_WIDTH = 960;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click a left-nav button by its data-tip (see src/App.jsx NAV).
async function gotoTab(page, tip) {
  await page.click(`button.nav-btn[data-tip="${tip}"]`);
  await sleep(900);
}

// best-effort click: never throw if the target isn't present in current data
async function tryClick(page, selector, timeout = 1500) {
  try { await page.click(selector, { timeout }); return true; } catch { return false; }
}

// ── the tabs we showcase (the ones the README highlights) ────────────────────
const TABS = [
  {
    id: 'home', tip: 'Morning digest',
    async steps(page) {
      await sleep(1200);                                   // let the digest + cards settle
      await tryClick(page, '.digest-toggle');              // expand "read more" stories
      await sleep(1200);
      await tryClick(page, '.feed-filter:has-text("email")'); // filter the agent feed
      await sleep(1000);
      await tryClick(page, 'button[aria-label="next month"]'); // month-grid nav
      await sleep(800);
      await tryClick(page, 'button[aria-label="previous month"]');
      await sleep(1200);
    },
  },
  {
    id: 'jobs', tip: 'Job board',
    async steps(page) {
      await sleep(1200);
      await tryClick(page, '.job-row, [class*="job-row"]');   // expand a listing's detail panel
      await sleep(1800);
      await page.mouse.wheel(0, 600);                          // scroll the board
      await sleep(1200);
    },
  },
  {
    id: 'graph', tip: 'Second brain',
    async steps(page) {
      await sleep(4500);                                       // the force graph settles on its own
      await page.mouse.wheel(0, -200);                         // a gentle zoom-in
      await sleep(1500);
    },
  },
  {
    id: 'research', tip: 'Research',
    async steps(page) {
      await sleep(1500);
      await page.mouse.wheel(0, 400);
      await sleep(1500);
    },
  },
];

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

function toGif(webm, gif) {
  const vf = `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
  const r = spawnSync('ffmpeg', ['-y', '-i', webm, '-vf', vf, gif], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${gif}`);
}

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('playwright is not installed. Run: npm i -D playwright && npx playwright install chromium'); process.exit(1); }
  if (!hasFfmpeg()) { console.error('ffmpeg not found on PATH (macOS: brew install ffmpeg).'); process.exit(1); }

  const only = process.argv[2];
  const tabs = only ? TABS.filter((t) => t.id === only) : TABS;
  if (!tabs.length) { console.error(`unknown tab "${only}". Known: ${TABS.map((t) => t.id).join(', ')}`); process.exit(1); }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  for (const tab of tabs) {
    const tmp = mkdtempSync(join(tmpdir(), `nexus-rec-${tab.id}-`));
    const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: tmp, size: VIEWPORT } });
    const page = await context.newPage();
    console.log(`[rec] ${tab.id} …`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await gotoTab(page, tab.tip);
    await tab.steps(page);
    await context.close();                                    // flush the .webm

    const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
    if (!webm) { console.warn(`[rec] no video captured for ${tab.id}`); rmSync(tmp, { recursive: true, force: true }); continue; }
    const gif = join(OUT_DIR, `${tab.id}.gif`);
    toGif(join(tmp, webm), gif);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`[rec] wrote ${gif}`);
  }

  await browser.close();
  console.log('[rec] done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
