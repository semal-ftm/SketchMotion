// End-to-end checks for SketchMotion using the locally installed Chrome.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.APP_URL ?? 'http://localhost:5173/';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const FIX = join(HERE, 'fixtures');
mkdirSync(join(dirname(fileURLToPath(import.meta.url)), 'out'), { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const engine = (page, expr) => page.evaluate(`(() => { const e = window.__sketchmotion; return ${expr}; })()`);

async function launch(extra = []) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--window-size=1440,900', '--enable-unsafe-swiftshader', ...extra],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
}

async function clickText(page, text, selector = 'button') {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent.trim());
    if (t.includes(text)) {
      await h.click();
      return true;
    }
  }
  throw new Error(`button "${text}" not found`);
}

async function mainFlow() {
  const browser = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('422') && errors.push(m.text()));
  let extractCalls = 0;
  page.on('request', (r) => r.url().includes('/api/extract') && extractCalls++);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('OpenCV'), { timeout: 15000 });
  check('frontend ↔ backend health connection', true);
  await page.screenshot({ path: join(OUT, 'shot-1-empty.png') });

  // --- sample extraction ---
  await clickText(page, 'Try the sample drawing', '.scene-empty button');
  await page.waitForSelector('.result-meta', { timeout: 20000 });
  const meta = await page.$eval('.result-meta', (el) => el.textContent);
  check('sample drawing extracted via FastAPI/OpenCV', /Threshold \d+/.test(meta), meta.trim());
  const sprite = await page.$eval('.compare-img.checker img', (img) => ({ w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 21) }));
  check('transparent PNG preview shown on checkerboard', sprite.src === 'data:image/png;base64' && sprite.w > 100, JSON.stringify(sprite));
  const steps = await page.$$eval('.cv-steps li', (l) => l.length);
  check('CV pipeline step thumbnails returned', steps === 6, `${steps} steps`);
  await sleep(2500); // let the character drop and settle
  const body = await engine(page, '({ x: e.body.x, y: e.body.y, hh: e.body.hh, floor: e.floorY, grounded: e.body.grounded, w: e.cssW, h: e.cssH, dpr: e.dpr, cw: e.canvas.width })');
  check('sprite dropped with gravity and rests on the floor', body.grounded && Math.abs(body.y + body.hh - body.floor) < 1, JSON.stringify(body));
  await page.screenshot({ path: join(OUT, 'shot-2-extracted.png') });

  // --- mouse drag & throw ---
  const rect = await page.$eval('.scene-surface canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const sx = rect.x + body.x;
  const sy = rect.y + body.y;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const held = await engine(page, 'e.isPointerHolding');
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(sx - i * 25, sy - i * 22);
    await sleep(16);
  }
  const during = await engine(page, '({ x: e.body.x, y: e.body.y, vx: e.body.vx, vy: e.body.vy })');
  await page.mouse.up();
  check('mouse grab on opaque sprite pixel', held);
  check('dragging moves the character', during.y < body.y - 120, JSON.stringify(during));
  await sleep(60);
  const thrown = await engine(page, '({ vx: e.body.vx, vy: e.body.vy, holding: e.isPointerHolding })');
  check('release keeps throw velocity', !thrown.holding && Math.hypot(thrown.vx, thrown.vy) > 150, JSON.stringify(thrown));
  let maxSquash = 0;
  for (let i = 0; i < 40; i++) {
    maxSquash = Math.max(maxSquash, await engine(page, 'e.body.squash'));
    await sleep(25);
  }
  check('squash-and-stretch on floor impact', maxSquash > 0.03, `max squash ${maxSquash.toFixed(3)}`);
  await sleep(2500);
  const rest = await engine(page, '({ grounded: e.body.grounded, x: e.body.x, hw: e.body.hw, w: e.cssW })');
  check('settles after bouncing, inside the walls', rest.grounded && rest.x >= rest.hw - 0.5 && rest.x <= rest.w - rest.hw + 0.5, JSON.stringify(rest));

  // Clicking empty background must not grab.
  await page.mouse.click(rect.x + 30, rect.y + 30);
  check('clicking empty space does not grab', !(await engine(page, 'e.isPointerHolding')));

  // --- keyboard ---
  await page.focus('.scene-surface');
  await page.keyboard.press('Space');
  await sleep(80);
  check('keyboard Space makes the character jump', (await engine(page, 'e.body.vy')) < -100);
  await sleep(1500);

  // --- controls ---
  await clickText(page, 'Cosmic Playground', '.scene-card');
  await sleep(300);
  check('scene switch (Cosmic, low gravity)', (await engine(page, 'e.settings.scene + ":" + e.scene.gravityScale')) === 'cosmic:0.45');
  await page.screenshot({ path: join(OUT, 'shot-3-cosmic.png') });
  await clickText(page, 'Pause', '.actions-row button');
  const y0 = await engine(page, 'e.body.y');
  await page.focus('.scene-surface');
  await page.keyboard.press('Space');
  await sleep(400);
  check('pause freezes physics', Math.abs((await engine(page, 'e.body.y')) - y0) < 0.01);
  await clickText(page, 'Resume', '.actions-row button');
  await clickText(page, 'Recenter', '.actions-row button');
  const rc = await engine(page, '({ x: e.body.x, w: e.cssW })');
  check('recenter', Math.abs(rc.x - rc.w / 2) < 1);
  // size slider -> collision extents change
  const hw0 = await engine(page, 'e.body.hw');
  await page.$eval('.panel-right input[type=range]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '1.5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  const hw1 = await engine(page, 'e.body.hw');
  check('size control rescales sprite + collider', hw1 > hw0 * 1.3, `${hw0.toFixed(1)} → ${hw1.toFixed(1)}`);
  await clickText(page, 'Dream Garden', '.scene-card');

  // --- resize / high-DPI ---
  await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 2 });
  await sleep(600);
  const r1 = await engine(page, '({ w: e.cssW, cw: e.canvas.width, dpr: e.dpr, x: e.body.x, hw: e.body.hw, y: e.body.y, hh: e.body.hh, floor: e.floorY })');
  check('high-DPI backing store (canvas px = css px × dpr)', r1.dpr === 2 && r1.cw === r1.w * 2, JSON.stringify(r1));
  check('character stays inside after resize', r1.x >= r1.hw - 0.5 && r1.x <= r1.w - r1.hw + 0.5 && r1.y <= r1.floor - r1.hh + 0.5);
  await page.screenshot({ path: join(OUT, 'shot-4-tablet.png'), fullPage: false });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
  await sleep(700);
  const r2 = await engine(page, '({ w: e.cssW, h: e.cssH, x: e.body.x, hw: e.body.hw })');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone layout: no horizontal overflow, canvas fits', overflow <= 0 && r2.w <= 390, JSON.stringify({ ...r2, overflow }));
  await page.screenshot({ path: join(OUT, 'shot-5-phone.png') });
  // touch drag on phone
  await sleep(1500);
  const pb = await engine(page, '({ x: e.body.x, y: e.body.y })');
  const prect = await page.$eval('.scene-surface canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', prect.x + pb.x, prect.y + pb.y);
  const touchHeld = await engine(page, 'e.isPointerHolding');
  for (let i = 1; i < 8; i++) { await tp('touchMove', prect.x + pb.x + i * 10, prect.y + pb.y - i * 15); await sleep(16); }
  await tp('touchEnd');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  check('touch drag works on phone layout', touchHeld);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(500);

  // --- threshold re-extraction ---
  const before = extractCalls;
  await clickText(page, 'Automatic threshold', '.field-row').catch(() => {});
  await page.$$eval('.panel-left button[role=switch]', (s) => s[0].click());
  await sleep(200);
  await page.$eval('.panel-left input[type=range]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const v of ['230', '228', '226']) { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForFunction(() => document.querySelector('.result-meta')?.textContent.includes('(manual)'), { timeout: 15000 });
  const after = extractCalls - before;
  check('manual threshold re-extracts (debounced, no request flood)', after >= 1 && after <= 2, `${after} request(s) for 4 changes`);

  // --- mask editor ---
  const spriteBefore = await page.$eval('.compare-img.checker img', (i) => i.src.length);
  await clickText(page, 'Fix mask');
  await page.waitForFunction(() => !document.querySelector('.mask-stage .cam-overlay'), { timeout: 10000 });
  await clickText(page, 'Erase', '.mask-toolbar button');
  const mrect = await page.$eval('.mask-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(mrect.x + mrect.w * 0.3, mrect.y + mrect.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(mrect.x + mrect.w * 0.7, mrect.y + mrect.h * 0.5, { steps: 10 });
  await page.mouse.up();
  await page.screenshot({ path: join(OUT, 'shot-6-mask.png') });
  await clickText(page, 'Apply to character');
  await sleep(500);
  const spriteAfter = await page.$eval('.compare-img.checker img', (i) => i.src.length);
  check('mask correction edits the sprite', spriteAfter !== spriteBefore);

  // --- invalid upload → helpful error ---
  const input = await page.$('input[type=file]');
  await input.uploadFile(join(FIX, 'blank.png'));
  await page.waitForSelector('.crop-wrap', { timeout: 5000 });
  await clickText(page, 'Extract character');
  await page.waitForSelector('.callout-error', { timeout: 15000 });
  const err = await page.$eval('.callout-error', (e) => e.textContent);
  check('blank page → explanatory error with tips (no fake result)', /No drawing lines/.test(err), err.slice(0, 90));
  await input.uploadFile(join(FIX, 'notes.txt'));
  await sleep(300);
  const err2 = await page.$$eval('.callout-error', (e) => e.map((x) => x.textContent).join(' | '));
  check('non-image file rejected client-side', /not a PNG or JPEG/.test(err2));
  await page.screenshot({ path: join(OUT, 'shot-7-error.png') });

  // --- webcam hand tracking with the default fake device (no hand) ---
  await clickText(page, 'Start hand tracking');
  await page.waitForFunction(() => /Looking for your hand|Camera unavailable/.test(document.querySelector('.cam-status')?.textContent ?? ''), { timeout: 30000 });
  const camText = await page.$eval('.cam-status', (e) => e.textContent);
  check('camera starts on click; status “Looking for your hand”', camText.includes('Looking for your hand'), camText);
  await page.waitForFunction(() => /CPU|[1-9]\d* fps/.test(document.querySelector('.perf')?.textContent ?? ''), { timeout: 30000 }).catch(() => {});
  await sleep(4000);
  const perf = await page.$eval('.perf', (e) => e.textContent).catch(() => '');
  const vstate = await page.evaluate(() => { const v = document.querySelector('.cam-preview video'); return JSON.stringify({ rs: v.readyState, w: v.videoWidth, t: v.currentTime.toFixed(2), paused: v.paused }); });
  check('MediaPipe inference loop running locally', /fps · inference/.test(perf), perf || vstate);
  await clickText(page, 'Stop camera');
  await sleep(300);
  const released = await page.evaluate(() => document.querySelector('.cam-preview video').srcObject === null);
  check('stopping releases the camera stream', released);

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

async function handFlow() {
  const browser = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(FIX, 'hand.mjpeg')}`]);
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await clickText(page, 'Try the sample drawing', '.scene-empty button');
  await page.waitForSelector('.result-meta', { timeout: 20000 });
  await sleep(1500);
  // Record status + gesture state every frame via the engine's hand state.
  await page.evaluate(() => {
    window.__log = [];
    const e = window.__sketchmotion;
    const orig = e.setHand.bind(e);
    e.setHand = (s) => {
      if (s) window.__log.push({ t: performance.now(), present: s.present, tracking: s.tracking, pinching: s.pinching, ratio: s.pinchRatio, px: s.pinchPoint?.x, events: s.events, holding: e.isHandHolding, bx: e.body.x / e.cssW });
      orig(s);
    };
  });
  await clickText(page, 'Start hand tracking');
  await page.waitForFunction(() => window.__log.some((l) => l.present), { timeout: 40000 }).catch(() => {});
  await sleep(9000);
  const log = await page.evaluate(() => window.__log);
  const statusSeen = await page.$eval('.cam-status', (e) => e.textContent);
  writeFileSync(join(OUT, 'hand-log.json'), JSON.stringify(log, null, 1));
  const present = log.filter((l) => l.present);
  const events = log.flatMap((l) => l.events);
  const ratios = present.map((l) => l.ratio).filter((r) => r != null);
  check('real MediaPipe detects the hand in the camera stream', present.length > 20, `${present.length}/${log.length} frames with a hand`);
  check('pinch ratio separates pointing vs fist', ratios.length && Math.max(...ratios) > 0.45 && Math.min(...ratios) < 0.3, `min ${Math.min(...ratios).toFixed(2)} max ${Math.max(...ratios).toFixed(2)}`);
  check('pinchstart / pinchend events fired', events.includes('pinchstart') && events.includes('pinchend'), events.filter((e) => e.startsWith('pinch')).join(','));
  check('grab happened while pinching near the character', log.some((l) => l.holding));
  check('tracking loss handled (grace → lost)', log.some((l) => l.tracking === 'grace') && events.includes('lost'), `grace frames ${log.filter((l) => l.tracking === 'grace').length}`);
  const pinchToggles = events.filter((e) => e.startsWith('pinch')).length;
  check('no pinch flicker (few, clean transitions)', pinchToggles <= 8, `${pinchToggles} transitions`);
  console.log('status at end:', statusSeen);
  await page.screenshot({ path: join(OUT, 'shot-8-hand.png') });
  await browser.close();
}

async function deniedFlow() {
  const browser = await launch(['--deny-permission-prompts', '--use-fake-device-for-media-stream']);
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await clickText(page, 'Try the sample drawing', '.scene-empty button');
  await page.waitForSelector('.result-meta', { timeout: 20000 });
  await clickText(page, 'Start hand tracking');
  await page.waitForSelector('.panel-right .callout-error', { timeout: 15000 });
  const msg = await page.$eval('.panel-right .callout-error', (e) => e.textContent);
  check('camera denied → clear message + fallback hint', /blocked/i.test(msg) && /mouse/i.test(msg), msg.slice(0, 100));
  await sleep(2000);
  const b = await engine(page, '({ x: e.body.x, y: e.body.y })');
  const rect = await page.$eval('.scene-surface canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await page.mouse.move(rect.x + b.x, rect.y + b.y);
  await page.mouse.down();
  const held = await engine(page, 'e.isPointerHolding');
  await page.mouse.up();
  check('mouse fallback still works after camera denial', held);
  await page.screenshot({ path: join(OUT, 'shot-9-denied.png') });
  await browser.close();
}

const which = process.argv[2] ?? 'all';
try {
  if (which === 'all' || which === 'main') await mainFlow();
  if (which === 'all' || which === 'denied') await deniedFlow();
  if (which === 'all' || which === 'hand') await handFlow();
} catch (e) {
  check('e2e script crashed', false, e.stack);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync(join(OUT, 'e2e-results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
