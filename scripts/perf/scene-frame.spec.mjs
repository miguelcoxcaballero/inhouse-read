import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { settledGeometryLength } from '../../tests/e2e/helpers/settled-geometry-length.mjs';

// CPU cost of the shelf scene's own frames in a real Chromium page (software GL): every
// requestAnimationFrame callback is timed in the page, and a CDP sampling profile of the same
// frames gives the inclusive time of the scene's per-frame functions. A diagnostic of the main
// thread only: no GPU, battery or phone measurement. Build the dist without minification
// (`npx vite build --minify false --outDir <dir>`) so that functions keep their names.
const BOOKS = Number(process.env.PERF_BOOKS || 36);
const THROTTLE = Number(process.env.PERF_THROTTLE || 4);
// Physics advances by the real elapsed time (up to 120 steps a frame): a throttled drag frame
// simulates more steps, so the drag runs unthrottled unless PERF_DRAG_THROTTLE says otherwise.
const DRAG_THROTTLE = Number(process.env.PERF_DRAG_THROTTLE || 1);
const SHELF = process.env.PERF_SHELF || 'walnut';
const FRAMES = Number(process.env.PERF_FRAMES || 150);
const ROUNDS = Number(process.env.PERF_ROUNDS || 3);
const SCENARIOS = (process.env.PERF_SCENARIOS || 'scroll,drag,turn').split(',');
const PREFIX = 'perf:book:';
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });

async function seed(page, mode) {
  await page.addInitScript(({ mode, shelf }) => {
    localStorage.setItem('inhouse-read-shelf-view', mode);
    localStorage.setItem('inhouse-read-shelf-type', shelf);
    localStorage.setItem('inhouse-read-shelf-plants', JSON.stringify([
      { key:'plant:perf-a', seed:'perf-a', catalogId:'sansevieria', variant:'sansevieria', potId:'muskot', width:42, height:124, shelf:0, x:.86 },
      { key:'plant:perf-b', seed:'perf-b', catalogId:'monstera', variant:'monstera', potId:'muskot', width:70, height:110, shelf:2, x:.84 }
    ]));
    localStorage.setItem('inhouse-read-shelf-lamps', JSON.stringify([
      { key:'lamp:perf-a', lampId:'tarnaby', shelf:1, x:.86, isOn:true },
      { key:'lamp:perf-b', lampId:'tarnaby', shelf:3, x:.86, isOn:true }
    ]));
    // Every animation frame callback is timed while a measurement is armed.
    const probe = window.__frameProbe = { on:false, frames:[], current:0 };
    const native = window.requestAnimationFrame.bind(window);
    // The callbacks of one frame run in one task; a timeout queued by the first closes the frame.
    let scheduled = false;
    const close = () => { scheduled = false; probe.frames.push(probe.current); probe.current = 0; };
    window.requestAnimationFrame = callback => native(time => {
      if (!probe.on) return callback(time);
      const start = performance.now();
      try { return callback(time); } finally {
        probe.current += performance.now() - start;
        if (!scheduled) { scheduled = true; setTimeout(close, 0); }
      }
    });
  }, { mode, shelf:SHELF });
  await page.goto('./');
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix, geometry, count }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const colours = ['#18364b', '#713b42', '#375a46', '#5b4a2e'];
    const covers = [];
    for (let index = 0; index < 4; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = colours[index]; context.fillRect(0, 0, 400, 600); context.fillStyle = '#e8e2cf';
      context.font = '32px serif'; context.fillText(`LIBRO ${index + 1}`, 56, 112);
      covers.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    }
    const transaction = db.transaction('books', 'readwrite'), books = transaction.objectStore('books');
    for (let index = 0; index < count; index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`perf-${index}.pdf`, format:'PDF', sourceType:'local',
      mimeType:'application/pdf', pageCount:180 + index % 5 * 60, ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:covers[index % 4],
      coverFinish:index % 2 ? 'satin' : 'glossy', spineSurfaceFinish:index % 2 ? 'satin' : 'glossy',
      spineColorOverride:colours[index % 4],
      shelfPosition:{ shelf:Math.floor(index / 9), x:.05 + index % 9 * .085 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, { bytes, prefix:PREFIX, geometry:await settledGeometryLength(78_000, 'scene-frame-perf'), count:BOOKS });
  await page.reload();
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(page.locator('.ihr-spine')).toHaveCount(BOOKS);
  await quiet(scene);
  return scene;
}

async function quiet(scene) {
  await scene.page().evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:120_000 });
  await expect(scene).toHaveAttribute('data-book-quality-pending', '0', { timeout:120_000 });
  await expect.poll(async () => {
    const before = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(500);
    return before === await scene.getAttribute('data-snapshot-render-count');
  }, { timeout:120_000 }).toBe(true);
}

// Inclusive time per function key over the profile's samples (a function counted once per sample).
function summarize(profile) {
  const byId = new Map(profile.nodes.map(node => [node.id, node])), parent = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
  const inclusive = new Map(), self = new Map();
  let total = 0;
  const key = node => {
    const { functionName, url, lineNumber } = node.callFrame;
    const file = url.split('/').pop() || url || '(native)';
    return `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`;
  };
  for (let index = 0; index < profile.samples.length; index++) {
    const delta = (profile.timeDeltas[index] || 0) / 1000;
    let node = byId.get(profile.samples[index]);
    const name = node.callFrame.functionName;
    if (name === '(idle)' || name === '(program)' || name === '(garbage collector)') {
      self.set(name, (self.get(name) || 0) + delta); continue;
    }
    total += delta;
    self.set(key(node), (self.get(key(node)) || 0) + delta);
    const seen = new Set();
    while (node) { const k = key(node); if (!seen.has(k)) { seen.add(k); inclusive.set(k, (inclusive.get(k) || 0) + delta); } node = byId.get(parent.get(node.id)); }
  }
  const top = (map, count) => [...map].sort((a, b) => b[1] - a[1]).slice(0, count).map(([k, v]) => [k, Number(v.toFixed(2))]);
  return { busyMs:Number(total.toFixed(2)), inclusive:top(inclusive, 400), self:top(self, 120) };
}

async function measured(page, session, run, rate) {
  await session.send('Emulation.setCPUThrottlingRate', { rate });
  await session.send('Profiler.setSamplingInterval', { interval:200 });
  await session.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  await session.send('Profiler.start');
  await page.evaluate(() => { const p = window.__frameProbe; p.frames = []; p.current = 0; p.on = true; });
  await run();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
  const frames = await page.evaluate(() => { const p = window.__frameProbe; p.on = false; return p.frames; });
  const { profile } = await session.send('Profiler.stop');
  const after = await metrics();
  // Layout and style passes are counted by the engine: unlike durations they do not depend on the load.
  const work = Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']
    .map(name => [name, Number(((after[name] ?? 0) - (before[name] ?? 0)).toFixed(4))]));
  if (process.env.PERF_OUT) await writeFile(`${process.env.PERF_OUT}.${Date.now()}.cpuprofile`, JSON.stringify(profile));
  await session.send('Emulation.setCPUThrottlingRate', { rate:1 });
  const sorted = frames.filter(value => value > 0).sort((a, b) => a - b);
  const pick = q => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3)) : null;
  return { work, frames:sorted.length, medianMs:pick(.5), p90Ms:pick(.9), maxMs:pick(1), totalMs:Number(sorted.reduce((a, b) => a + b, 0).toFixed(2)), profile:summarize(profile) };
}

const scenarios = {
  // Frontal view: the camera follows a steady scroll, one draw per frame.
  async scroll(page) {
    await page.evaluate(async frames => {
      const scroller = document.querySelector('.ihr-bookshelf__scroll');
      const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      for (let frame = 0; frame < frames; frame++) {
        scroller.scrollTop = Math.round(max / 2 + Math.sin(frame / 20) * Math.min(300, max / 2));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }, FRAMES);
  },
  // Diagonal view: a book is held and dragged sideways, pushing its neighbours (physics frames).
  async drag(page) {
    const point = await page.evaluate(() => {
      const scroller = document.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect();
      for (const node of document.querySelectorAll('.ihr-spine')) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 4 && rect.top > scroller.top + 20 && rect.bottom < scroller.bottom - 20 && rect.left > 30 && rect.right < innerWidth - 60)
          return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2, id:node.dataset.bookId };
      }
      return null;
    });
    expect(point).not.toBeNull();
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await expect(page.locator(`[data-book-id="${point.id}"]`)).toHaveClass(/is-lifted/);
    await page.evaluate(async ({ x, y, id, frames }) => {
      const node = document.querySelector(`[data-book-id="${id}"]`);
      for (let frame = 1; frame <= frames; frame++) {
        node.dispatchEvent(new PointerEvent('pointermove', { pointerId:1, pointerType:'mouse', buttons:1,
          clientX:x + Math.sin(frame / 12) * 40, clientY:y, bubbles:true, cancelable:true }));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }, { ...point, frames:FRAMES });
    await page.mouse.up();
  },
  // The turn between the frontal and the diagonal view and back.
  async turn(page) {
    for (const mode of ['spine', 'isometric']) {
      const root = page.locator('[data-ihr-bookshelf]');
      // A swipe that lands on a book presses it instead: retry a little lower.
      for (let attempt = 0; attempt < 4 && await root.getAttribute('data-view-mode') !== mode; attempt++) {
        const box = await page.locator('.ihr-bookshelf__scroll').boundingBox();
        const y = box.y + Math.min(72, box.height * .2) + attempt * 37, left = box.x + box.width * .22, right = box.x + box.width * .78;
        const [start, end] = mode === 'isometric' ? [right, left] : [left, right];
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:start, y, id:0 }] });
        for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:start + (end - start) * step / 6, y, id:0 }] });
        await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
        await cdp.detach();
        await expect(root).toHaveAttribute('data-view-mode', mode, { timeout:8_000 }).catch(() => {});
      }
      await expect(root).toHaveAttribute('data-view-mode', mode);
      await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating', 'false', { timeout:240_000 });
    }
  }
};

test('scene frame cost', async ({ page }) => {
  const results = [];
  for (const name of SCENARIOS) {
    const mode = name === 'scroll' ? 'spine' : 'isometric';
    for (let round = 0; round < ROUNDS; round++) {
      const context = page.context(), fresh = round === 0 && name === SCENARIOS[0] ? page : await context.newPage();
      const scene = await seed(fresh, mode);
      const session = await context.newCDPSession(fresh);
      await session.send('Profiler.enable');
      const rate = name === 'drag' ? DRAG_THROTTLE : THROTTLE;
      const result = await measured(fresh, session, () => scenarios[name](fresh), rate);
      results.push({ name, round, throttle:rate, ...result, renders:Number(await scene.getAttribute('data-render-count')) });
      await save(results);
      await session.detach();
      if (fresh !== page) await fresh.close();
      console.log(`${name} #${round}: frames ${result.frames}, median ${result.medianMs} ms, p90 ${result.p90Ms} ms, busy ${result.profile.busyMs} ms`);
    }
  }
});

// Written after every scenario, so a later failure keeps the measurements already taken.
async function save(results) {
  const report = { date:new Date().toISOString(), books:BOOKS, shelf:SHELF, throttle:THROTTLE, dragThrottle:DRAG_THROTTLE, framesPerScenario:FRAMES,
    scope:'main-thread CPU of requestAnimationFrame callbacks and sampled profile, software GL, shared 4-core host', results };
  if (process.env.PERF_OUT) await writeFile(process.env.PERF_OUT, JSON.stringify(report, null, 1) + '\n');
}
