import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';

const BOOK_PREFIX = 'motion:book:';
const LAMP_KEY = 'inhouse-read-shelf-lamps';
const PLANT_KEY = 'inhouse-read-shelf-plants';
const TARGET_URL = process.env.IHR_TEST_URL || '/';
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });

async function seedShelf(page) {
  await page.addInitScript(({ lampKey, plantKey }) => {
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem(plantKey, JSON.stringify([
      { key:'plant:motion', seed:'motion', catalogId:'sansevieria', variant:'sansevieria',
        potId:'muskot', width:42, height:124, shelf:0, x:.76 }
    ]));
    localStorage.setItem(lampKey, JSON.stringify([
      { key:'lamp:motion', lampId:'tarnaby', shelf:1, x:.56, isOn:true }
    ]));
  }, { lampKey:LAMP_KEY, plantKey:PLANT_KEY });
  await page.goto(TARGET_URL);
  await expect(page.locator('.ihr-bookshelf').first()).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix, geometry }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const covers = [];
    for (let index = 0; index < 6; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = ['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)];
      context.fillRect(0, 0, 400, 600); context.fillStyle = '#e8e2cf';
      context.font = '32px serif'; context.fillText(`LIBRO ${index + 1}`, 56, 112);
      covers.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    }
    const transaction = db.transaction('books', 'readwrite'), books = transaction.objectStore('books');
    for (let index = 0; index < 6; index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`motion-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:260,
      ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:covers[index],
      coverFinish:index % 2 ? 'satin' : 'glossy', spineSurfaceFinish:index % 2 ? 'satin' : 'glossy',
      spineColorOverride:['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)],
      shelfPosition:{ shelf:Math.floor(index / 2), x:index % 2 ? .38 : .19 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); db.close();
  }, { bytes, prefix:BOOK_PREFIX, geometry:settledGeometryLength(78_000, 'shelf-motion') });
  return;
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(page.locator('.ihr-spine')).toHaveCount(6);
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(page.locator('.ihr-lamp')).toHaveCount(1);
  await expect(scene).toHaveAttribute('data-shelf-type', 'baggebo');
  await expect(scene).toHaveAttribute('data-view-progress', '1');
  await quietShelf(scene);
  return scene;
}


const TRIALS = Number(process.env.TRIALS || 1), THROTTLE = Number(process.env.CPU || 4);
test('startup measurement', async ({ page, context }) => {
  test.setTimeout(600_000);
  await seedShelf(page);
  const client = await context.newCDPSession(page);
  const results = [];
    await page.addInitScript(() => {
      window.__invLog = []; window.__m = { long:[], appear:0, renders:[], tap:0, anim:0, dirty:[] };
      new MutationObserver(rs => { for (const r of rs) window.__m.dirty.push([Math.round(performance.now()), r.target.getAttribute('data-inspection-dirty-source')]); }).observe(document, { attributes:true, attributeFilter:['data-inspection-dirty-source'], subtree:true });
      new PerformanceObserver(l => window.__m.long.push(...l.getEntries().map(e => [Math.round(e.startTime), Math.round(e.duration)]))).observe({ type:'longtask', buffered:true });
      const seen = () => {
        
      };
      new MutationObserver(seen).observe(document, { childList:true, subtree:true });
      addEventListener('pointerdown', () => { window.__m.tap ||= performance.now(); }, true);
      new MutationObserver(records => {
        if (!window.__m.tap || window.__m.anim) return;
        for (const r of records) if (r.type === 'attributes' && r.target.classList?.contains('ihr-spine') && /is-(pressed|lifted|opening|away|dragging)/.test(r.target.className)) { window.__m.anim = performance.now(); return; }
        if (document.querySelector('.ihr-bookshelf[data-opening], .ihr-bookshelf-scene[data-opening-book]')) window.__m.anim = performance.now();
      }).observe(document, { attributes:true, attributeFilter:['class','data-opening','data-opening-book'], subtree:true });
      const tick = () => { const sc = document.querySelector('.ihr-bookshelf-scene'); if (sc) { const n = sc.getAttribute('data-snapshot-render-count'); const last = window.__m.renders.at(-1); if (!last || last[1] !== n) window.__m.renders.push([Math.round(performance.now()), n]); if (n && !window.__m.appear) window.__m.appear = performance.now(); } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  for (let trial = 0; trial < TRIALS; trial++) {
    await client.send('Emulation.setCPUThrottlingRate', { rate:THROTTLE });
    await page.goto(TARGET_URL);
    await page.waitForFunction(() => window.__m.appear > 0, null, { timeout:60_000, polling:10 });
    const spine = page.locator('.ihr-spine').nth(0);
    const box = await spine.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(6000);
    const m = await page.evaluate(() => ({ ...window.__m, inv:window.__invLog }));
    console.log('INV ' + m.inv.map(x => `${x[0]} dirty=${x[1]} src=${x[2]} ${x[3].replace(/\?t=\d+/g,'').replace(/ at /g,' ').slice(0,230)}`).join('|||'));
    const after = m.long.filter(([s]) => s >= m.appear - 5);
    results.push({ appearMs:Math.round(m.appear), tapToAnimMs:m.anim && m.tap ? Math.round(m.anim - m.tap) : null,
      appearToTapMs:Math.round(m.tap - m.appear), longTasksAfterAppear:m.long.map(([s, d]) => `${s}+${d}`),
      longTotalMs:after.reduce((t, [, d]) => t + d, 0), dirty:m.dirty.map(([t,v]) => `${t}:${v}`).slice(0,30), renders:m.renders.map(([t, n]) => `${t}:${n}`).slice(0, 20) });
    await page.reload().catch(() => {});
    await client.send('Emulation.setCPUThrottlingRate', { rate:1 });
  }
  console.log('STARTUP ' + JSON.stringify(results, null, 1));
});
