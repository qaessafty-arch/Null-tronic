// End-to-end workflows (Playwright, real browser, real Python service).
// Usage: node tests/e2e/workflows.mjs   (starts Vite and the backend itself)
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'ntcs-e2e-'));
const APP = process.env.NTCS_URL ?? 'http://localhost:5199/';
const HAND_PORT = 8799;
const results = [];
const procs = [];

function start(cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`server ${url} did not start`);
}
function assert(c, msg) {
  if (!c) throw new Error(msg);
}

async function workflow(name, fn, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    // force the download fallback (no native file pickers in automation)
    delete window.showSaveFilePicker;
    window.showSaveFilePicker = undefined;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket/.test(m.text()) && errors.push(m.text()));
  const t0 = Date.now();
  try {
    await page.goto(APP);
    await page.waitForSelector('[data-testid=viewport-2d] canvas');
    await fn(page);
    assert(errors.length === 0, `runtime errors: ${errors.join(' | ')}`);
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`FAIL  ${name}: ${e.message}`);
    await page.screenshot({ path: join(TMP, `${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  }
  await ctx.close();
}

// ---- helpers running in the page
const state = (page, fn) => page.evaluate(fn);
async function screenOf(page, wx, wy) {
  return page.evaluate(
    ([x, y]) => {
      const a = window.__ntcs.getAdapter('2d');
      const w0 = a.normalizedToWorld(0, 0);
      const w1 = a.normalizedToWorld(1, 1);
      const r = document.querySelector('[data-testid=viewport-2d] canvas').getBoundingClientRect();
      return { x: r.left + ((x - w0.x) / (w1.x - w0.x)) * r.width, y: r.top + ((y - w0.y) / (w1.y - w0.y)) * r.height, nx: (x - w0.x) / (w1.x - w0.x), ny: (y - w0.y) / (w1.y - w0.y) };
    },
    [wx, wy],
  );
}
async function clickWorld(page, wx, wy) {
  const s = await screenOf(page, wx, wy);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.up();
}
const counts = (page) => state(page, () => { const p = window.__ntcs.store.get().project; return { c: Object.keys(p.components).length, w: Object.keys(p.wires).length, rooms: Object.keys(p.rooms).length, ann: Object.keys(p.annotations).length }; });
async function placeFromLibrary(page, type, wx, wy) {
  await page.click(`.lib-item[data-type="${type}"]`);
  await clickWorld(page, wx, wy);
}
async function download(page, trigger) {
  const [d] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = join(TMP, d.suggestedFilename());
  await d.saveAs(path);
  return path;
}
async function openExample(page, title) {
  await page.click('text=Help');
  await page.click('text=Examples & tutorials…');
  await page.click(`.ex-list li:has-text("${title}")`);
  await page.click('button:has-text("Open example")');
  await page.waitForTimeout(800);
  await page.keyboard.press('f');
}
async function connectHand(page, script, jsonl) {
  execFileSync('python3', [join(ROOT, 'tests/e2e/hand_script.py'), jsonl, JSON.stringify(script)]);
  const svc = start('python3', ['-m', 'nulltech_backend', '--replay', jsonl, '--once', '--wait-client', '--no-mirror', '--margin', '0', '--port', String(HAND_PORT)], { cwd: join(ROOT, 'backend') });
  await sleep(1200);
  await page.click('.hand-pill');
  await page.fill('input[value^="ws://"]', `ws://127.0.0.1:${HAND_PORT}`);
  await page.click('button:has-text("Enable hand tracking")');
  await page.waitForFunction(() => window.__ntcs.store.get().hand.connection === 'connected', null, { timeout: 8000 });
  await page.keyboard.press('Escape');
  return svc;
}
async function disconnect(page, svc) {
  await page.click('.hand-pill');
  await page.click('button:has-text("Disable hand tracking")');
  await page.keyboard.press('Escape');
  svc.kill();
}

// ---------------------------------------------------------------- workflows
async function wf1(page) {
  // new circuit, V + R, connect, simulate, inspect, save, reopen, export schematic
  await page.click('.welcome button:has-text("New project")');
  await page.click('button:has-text("Create project")');
  await placeFromLibrary(page, 'vdc', 0, 10);
  await placeFromLibrary(page, 'resistor', 15, 5);
  await placeFromLibrary(page, 'ground', 0, 25);
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await clickWorld(page, 0, 5);
  await clickWorld(page, 10, 5); // V1+ → R1.1
  await clickWorld(page, 20, 5);
  await clickWorld(page, 20, 15);
  await clickWorld(page, 0, 15); // R1.2 → (bend) → V1−
  await clickWorld(page, 0, 15);
  await clickWorld(page, 0, 25); // V1− → GND
  await page.keyboard.press('Escape');
  const c = await counts(page);
  assert(c.c === 3 && c.w === 3, `expected 3 parts / 3 wires, got ${JSON.stringify(c)}`);
  await page.keyboard.press('F5');
  await page.waitForFunction(() => window.__ntcs.store.get().sim.result?.ok === true);
  const i = await state(page, () => { const s = window.__ntcs.store.get(); const r1 = Object.values(s.project.components).find((x) => x.ref === 'R1'); return s.sim.result.components[r1.id].current; });
  assert(Math.abs(Math.abs(i) - 0.009) < 1e-9, `R1 current ${i}`);
  await page.waitForSelector('text=Operating point');
  const saved = await download(page, () => page.keyboard.press('Control+s'));
  const text = readFileSync(saved, 'utf8');
  assert(JSON.parse(text).format === 'nulltech-circuit-studio-project', 'saved file format');
  // reopen
  await page.click('.welcome button, .toolbar button[title^="New project"]').catch(() => {});
  await page.keyboard.press('Escape');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(saved);
  await page.waitForTimeout(400);
  const c2 = await counts(page);
  assert(c2.c === 3 && c2.w === 3, `reopened ${JSON.stringify(c2)}`);
  await page.keyboard.press('Control+p');
  const pdf = await download(page, () => page.click('button:has-text("Export vector PDF")'));
  const head = readFileSync(pdf).subarray(0, 8).toString('latin1');
  assert(head.startsWith('%PDF-1.4'), 'PDF header');
}

async function wf2(page) {
  // building plan, lights & sockets, circuits, 3D, drawing, PDF
  await openExample(page, 'Residential flat installation');
  const before = await counts(page);
  await placeFromLibrary(page, 'light', 2000, 2000);
  await placeFromLibrary(page, 'socket', 5500, 300);
  await page.keyboard.press('Escape');
  const after = await counts(page);
  assert(after.c === before.c + 2, 'devices placed');
  // new circuit: board → the two new devices, previewed then confirmed
  await page.keyboard.press('c');
  const db = await state(page, () => Object.values(window.__ntcs.store.get().project.components).find((x) => x.type === 'db').position);
  await clickWorld(page, db.x, db.y);
  await clickWorld(page, 2000, 2000);
  await clickWorld(page, 5500, 300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('button:has-text("Confirm")');
  await page.keyboard.press('Enter');
  const nCirc = await state(page, () => Object.keys(window.__ntcs.store.get().project.circuits).length);
  assert(nCirc === 7, `circuits ${nCirc}`);
  await page.keyboard.press('Escape');
  await page.click('.tabs button:has-text("Schedule")');
  await page.waitForSelector('td:has-text("C7")');
  await page.keyboard.press('2');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(TMP, 'wf2-3d.png') });
  await page.keyboard.press('1');
  await page.keyboard.press('Control+p');
  await page.click('button:has-text("+ Add sheet")');
  await page.click('button:has-text("+ Add sheet")');
  const pdf = await download(page, () => page.click('button:has-text("Export vector PDF")'));
  const body = readFileSync(pdf).toString('latin1');
  const pages = (body.match(/\/Type \/Page\b/g) ?? []).length;
  assert(pages === 3, `PDF pages ${pages}`);
}

async function wf3and4(page) {
  // Hand tracking: place, connect (preview + confirm), undo, redo — then the same with the mouse
  await openExample(page, 'LED with series resistor');
  await page.click('.lib-item[data-type="resistor"]');
  const place = await screenOf(page, 20, 15);
  assert(place.nx > 0.05 && place.nx < 0.95 && place.ny > 0.05 && place.ny < 0.95, 'hand target inside the viewport');
  const svc1 = await connectHand(page, [['none', 0.3], ['point', place.nx, place.ny, 0.6], ['pinch', place.nx, place.ny, 0.4], ['point', place.nx, place.ny, 0.5], ['fist', place.nx, place.ny, 0.6], ['point', place.nx, place.ny, 0.4]], join(TMP, 'h1.jsonl'));
  await page.waitForFunction(() => Object.keys(window.__ntcs.store.get().project.components).length === 6, null, { timeout: 10000 });
  await disconnect(page, svc1);
  const r2 = await state(page, () => Object.values(window.__ntcs.store.get().project.components).find((x) => x.ref === 'R2'));
  assert(r2 && r2.position.x === 20 && r2.position.y === 15, `hand placement at ${JSON.stringify(r2?.position)}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  const a = await screenOf(page, 15, 15);
  const b = await screenOf(page, 35, 5);
  const svc2 = await connectHand(page, [['none', 0.3], ['point', a.nx, a.ny, 0.5], ['pinch', a.nx, a.ny, 0.3], ['drag', a.nx, a.ny, b.nx, b.ny, 0.8], ['pinch', b.nx, b.ny, 0.4], ['point', b.nx, b.ny, 0.5], ['fist', b.nx, b.ny, 0.6], ['point', b.nx, b.ny, 0.3]], join(TMP, 'h2.jsonl'));
  await page.waitForFunction(() => Object.keys(window.__ntcs.store.get().project.wires).length === 5, null, { timeout: 10000 });
  await disconnect(page, svc2);
  const netOk = await state(page, () => {
    const p = window.__ntcs.store.get().project;
    const r2 = Object.values(p.components).find((x) => x.ref === 'R2');
    return Object.values(p.wires).some((w) => w.a.componentId === r2.id || w.b.componentId === r2.id);
  });
  assert(netOk, 'hand wire attached to R2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  assert((await counts(page)).w === 4, 'undo removed the hand wire');
  await page.keyboard.press('Control+y');
  assert((await counts(page)).w === 5, 'redo restored the hand wire');
  const handNets = await state(page, () => JSON.stringify(Object.values(window.__ntcs.store.get().project.wires).map((w) => [w.a.pinId ?? 'j', w.b.pinId ?? 'j']).sort()));
  // Workflow 4: same operations with mouse and keyboard on a fresh copy of the example
  await openExample(page, 'LED with series resistor');
  await placeFromLibrary(page, 'resistor', 20, 15);
  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  await clickWorld(page, 15, 15);
  await clickWorld(page, 35, 5);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  const mouseNets = await state(page, () => JSON.stringify(Object.values(window.__ntcs.store.get().project.wires).map((w) => [w.a.pinId ?? 'j', w.b.pinId ?? 'j']).sort()));
  assert(handNets === mouseNets, `hand and mouse results differ: ${handNets} vs ${mouseNets}`);
}

async function wf5(page) {
  // import a DXF floor plan, modify, export DXF without losing supported data
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'WALLS', '90', '4', '70', '1', '10', '0', '20', '0', '10', '5', '20', '0', '10', '5', '20', '4', '10', '0', '20', '4',
    '0', 'TEXT', '8', 'TXT', '10', '0.5', '20', '4.5', '40', '0.3', '1', 'OFFICE 01', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const file = join(TMP, 'plan.dxf');
  writeFileSync(file, dxf);
  await page.click('.welcome button:has-text("New project")');
  await page.click('.type-card:has-text("Electrical installation")');
  await page.click('button:has-text("Create project")');
  await page.click('.menu > button:has-text("File")');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Import DXF rooms (closed polylines)…')]);
  await chooser.setFiles(file);
  await page.waitForTimeout(400);
  const c = await counts(page);
  assert(c.rooms === 1 && c.ann === 2, `import ${JSON.stringify(c)}`);
  await page.keyboard.press('f');
  await placeFromLibrary(page, 'light', 2500, -2000);
  await page.keyboard.press('Escape');
  await page.click('.menu > button:has-text("Export")');
  const out = await download(page, () => page.click('text=DXF (model space)'));
  const text = readFileSync(out, 'utf8');
  assert(text.includes('OFFICE 01'), 'text kept');
  assert(/\n10\n5000\.0\n20\n0\.0\n/.test(text), 'room vertex (5 m → 5000 mm) kept');
  assert(text.includes('UNDERLAY') && text.includes('COMPONENTS') && text.includes('ARCHITECTURE'), 'layers kept');
}

// ---------------------------------------------------------------- run
const vite = start('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: join(ROOT, 'frontend') });
try {
  await waitHttp(APP);
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  await workflow('Workflow 1: electronic circuit — build, simulate, save, reopen, export', wf1, browser);
  await workflow('Workflow 2: installation — plan, devices, circuit, 3D, drawings PDF', wf2, browser);
  await workflow('Workflows 3+4: hand tracking vs mouse — place, connect, confirm, undo, redo', wf3and4, browser);
  await workflow('Workflow 5: DXF import → modify → DXF export', wf5, browser);
  await browser.close();
} finally {
  procs.forEach((p) => p.kill());
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} workflows passed. Artifacts: ${TMP}`);
process.exit(failed.length ? 1 : 0);
