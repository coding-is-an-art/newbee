"use strict";

const { firefox } = require("playwright");

// ── Environment detection ──────────────────────────────────────
const IS_CI      = !!(process.env.GITHUB_ACTIONS || process.env.CI);
const IS_TERMUX  = !!(process.env.TERMUX_VERSION || (process.env.PREFIX && process.env.PREFIX.includes("com.termux")));

// ── Config ────────────────────────────────────────────────────
const TARGET_URLS  = [
  "https://visio-nexus.netlify.app/",
  "https://gooindia.netlify.app/"
];
const MAX_LOOPS    = parseInt(process.env.MAX_LOOPS    || "999999");
const LOOP_DELAY   = parseInt(process.env.LOOP_DELAY_MS || "25000"); 
const PAGE_TIMEOUT = 60000;

const ENGINES = [
  { name: "duckduckgo",  url: "https://duckduckgo.com/?q=" },
  { name: "bing",        url: "https://www.bing.com/search?q=" },
  { name: "yahoo",       url: "https://search.yahoo.com/search?p=" },
  { name: "ecosia",      url: "https://www.ecosia.org/search?q=" },
  { name: "brave",       url: "https://search.brave.com/search?q=" },
];

const SEARCH_QUERIES = [
  "top+indian+search+engine+2026",
  "visio+nexus+security+solutions",
  "gooindia+fast+browser+search",
  "privacy+first+search+india"
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

// ── Helpers ──────────────────────────────────────────────────
const sleep   = (ms) => new Promise((r) => setTimeout(r, ms));
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick    = (arr) => arr[randInt(0, arr.length - 1)];

function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

// ── Humanoid Mouse Strategies ───────────────────────────────
async function humanMouseMove(page, x0, y0, x1, y1, strategy = "Natural Arc") {
  const steps = randInt(50, 90);
  const cx1 = x0 + (x1 - x0) * rand(0.1, 0.4) + rand(-100, 100);
  const cy1 = y0 + (y1 - y0) * rand(0.1, 0.3) + rand(-80, 80);
  const cx2 = x0 + (x1 - x0) * rand(0.6, 0.9) + rand(-100, 100);
  const cy2 = y0 + (y1 - y0) * rand(0.7, 1.0) + rand(-80, 80);

  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    const jitter = (1 - t) * 2;
    let mx = bezierPoint(t, x0, cx1, cx2, x1) + rand(-jitter, jitter);
    let my = bezierPoint(t, y0, cy1, cy2, y1) + rand(-jitter, jitter);
    await page.mouse.move(mx, my);
    await sleep(rand(10, 25));
  }
}

async function moveMouseTo(page, x, y, strategy = "Natural Arc") {
  const cur = await page.evaluate(() => ({ x: window.innerWidth/2, y: window.innerHeight/2 }));
  await humanMouseMove(page, cur.x, cur.y, x, y, strategy);
}

// ── Ad Clicking Logic ────────────────────────────────────────
async function scanAndClickAd(page, viewport) {
  log("      🔍 Scanning for ads...");
  
  // Look for common AdSense selectors
  const adSelectors = [
    "ins.adsbygoogle",
    "iframe[id*='google_ads_iframe']",
    "iframe[src*='googleads']"
  ];
  
  let adElement = null;
  for (const sel of adSelectors) {
    adElement = await page.$(sel);
    if (adElement) break;
  }

  if (!adElement) {
    log("      ⏭️  No ad found this iteration.");
    return false;
  }

  const box = await adElement.boundingBox();
  if (!box || box.width < 100 || box.height < 50) {
    log("      ⏭️  Ad found but invalid size.");
    return false;
  }

  log(`      🎯 Ad found! [${adElement._name || "Google Ad"}] ${Math.round(box.width)}x${Math.round(box.height)}`);
  
  // 1. Cautious Hover
  log('      🖱️  Approaching ad via "Cautious Hover"…');
  const hoverX = box.x + box.width * rand(0.2, 0.8);
  const hoverY = box.y + box.height * rand(0.2, 0.8);
  await moveMouseTo(page, hoverX - rand(10, 30), hoverY - rand(10, 30));
  
  // 2. Hesitation
  log('      ⏸  Hesitating (reading ad)…');
  await sleep(rand(3000, 6000));
  
  // 3. Final Approach
  log('      🖱️  Final approach via "Natural Arc"…');
  await page.mouse.move(hoverX, hoverY, { steps: 10 });
  
  // 4. Click
  log('      👁  Reading ad text…');
  await sleep(rand(500, 1500));
  log('      🖱️  Clicking ad…');
  await page.mouse.click(hoverX, hoverY);
  log('      ✅ Ad clicked!');

  // 5. Viewing Ad Page
  log('      👀 Viewing ad content…');
  await sleep(rand(10000, 20000)); // Long stay on ad page
  
  // Ad page interaction: slow scroll
  const adSteps = randInt(2, 4);
  for (let i = 1; i <= adSteps; i++) {
    await page.mouse.wheel(0, rand(300, 600));
    log(`      ↓ Ad Scroll ${i}/${adSteps}`);
    await sleep(rand(3000, 6000));
  }

  // 6. Go Back
  log('      🔙 Navigating back...');
  await page.goBack().catch(() => {});
  await sleep(4000);
  
  return true;
}

// ── Realistic Interaction ────────────────────────────────────
async function humanoidScrollSequence(page, viewport, targetBottom = false) {
  const totalH = await page.evaluate(() => document.body.scrollHeight).catch(() => 4000);
  const scrollLimit = totalH - viewport.height;
  if (scrollLimit <= 0) return;

  const steps = targetBottom ? randInt(5, 7) : randInt(2, 3);
  log(`      📏 Height: ${totalH}px | Steps: ${steps}`);

  let currentPos = 0;
  for (let i = 1; i <= steps; i++) {
    const progressLimit = (i / steps) * scrollLimit;
    const target = Math.min(scrollLimit, progressLimit + rand(-100, 100));
    
    const wheelSteps = randInt(8, 15);
    const stepSize = (target - currentPos) / wheelSteps;

    for (let j = 0; j < wheelSteps; j++) {
      await page.mouse.wheel(0, stepSize + rand(-10, 10));
      await sleep(rand(80, 200));
    }
    currentPos = target;
    log(`      ↓ Scroll ${i}/${steps} ~${Math.round(target)}px`);
    await sleep(rand(3000, 6000));
  }
}

// ── Main Logic ───────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] ${msg}`);
}

(async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           GooIndia — Humanoid Ad-Clicker Bot v4.0            ║
╠══════════════════════════════════════════════════════════════╣
║  Targets : Visio-Nexus & GooIndia                            ║
║  Features: Ad Scan, Cautious Hover, Natural Arc, Reading     ║
╚══════════════════════════════════════════════════════════════╝
`);

  const browser = await firefox.launch({ headless: IS_CI });
  let loop = 0;

  while (loop < MAX_LOOPS) {
    loop++;
    const target = pick(TARGET_URLS);
    log(`\n━━━ Visit #${loop} ━━ Target: ${target} ━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const engine   = pick(ENGINES);
    const referrer = engine.url + pick(SEARCH_QUERIES);
    const ua       = pick(USER_AGENTS);
    const viewport = pick(VIEWPORTS);

    log(`   🔎 Source   : ${engine.name}`);
    log(`   🖥  Devices  : Humanoid Interaction`);
    log(`   📐 Viewport : ${viewport.width}x${viewport.height}`);

    const context = await browser.newContext({ userAgent: ua, viewport, extraHTTPHeaders: { 'Referer': referrer }});
    const page = await context.newPage();

    try {
      log(`   🌐 Navigating to ${target}`);
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
      await sleep(rand(4000, 7000));

      // 1. Initial interaction
      await humanoidScrollSequence(page, viewport, false);

      // 2. Scan and Click Ad
      const adClicked = await scanAndClickAd(page, viewport);

      // 3. Final Interaction (Scroll to Bottom)
      log(`      ⏬ Finalizing visit (Scan-and-Scroll Bottom)…`);
      await humanoidScrollSequence(page, viewport, true);

      log(`      ✅ Visit complete`);
    } catch (err) {
      log(`      ⚠️ Error: ${err.message.substring(0, 100)}`);
    } finally {
      await context.close();
    }

    log(`   ⏳ Waiting ${LOOP_DELAY / 1000}s before next visit…`);
    await sleep(LOOP_DELAY);
  }

  await browser.close();
})();
