import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { settledGeometryLength } from '../../tests/e2e/helpers/settled-geometry-length.mjs';

// CPU profile of a warm reload of a seeded shelf, from navigation to the first quiet room (main
// thread only, software GL). Run with PERF_SPEC=startup (see scene-frame.config.mjs).
const BOOKS = Number(process.env.PERF_BOOKS || 36);
const THROTTLE = Number(process.env.PERF_THROTTLE || 4);
const ROUNDS = Number(process.env.PERF_ROUNDS || 3);
const PREFIX = 'perf:book:';
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });

async function seed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-plants', JSON.stringify([
      { key:'plant:perf-a', seed:'perf-a', catalogId:'sansevieria', variant:'sansevieria', potId:'muskot', width:42, height:124, shelf:0, x:.86 }
    ]));
    localStorage.setItem('inhouse-read-shelf-lamps', JSON.stringify([{ key:'lamp:perf-a', lampId:'tarnaby', shelf:1, x:.86, isOn:true }]));
  });
  await page.goto('./');
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix, geometry, count }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('books', 'readwrite'), books = transaction.objectStore('books');
    for (let index = 0; index < count; index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`perf-${index}.pdf`, format:'PDF', sourceType:'local',
      mimeType:'application/pdf', pageCount:180 + index % 5 * 60, ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      spineColorOverride:['#18364b', '#713b42', '#375a46', '#5b4a2e'][index % 4],
      shelfPosition:{ shelf:Math.floor(index / 9), x:.05 + index % 9 * .085 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, { bytes, prefix:PREFIX, geometry:await settledGeometryLength(78_000, 'scene-frame-perf'), count:BOOKS });
}

async function quiet(page) {
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:240_000 });
  await expect(scene).toHaveAttribute('data-book-quality-pending', '0', { timeout:240_000 });
}

test('scene startup cost', async ({ page }) => {
  const results = [];
  await seed(page);
  await page.reload(); await quiet(page);
  for (let round = 0; round < ROUNDS; round++) {
    const session = await page.context().newCDPSession(page);
    await session.send('Profiler.enable');
    await session.send('Emulation.setCPUThrottlingRate', { rate:THROTTLE });
    await session.send('Profiler.setSamplingInterval', { interval:200 });
    await session.send('Profiler.start');
    const started = Date.now();
    await page.reload();
    await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-render-count', /^[1-9]/, { timeout:240_000 });
    const firstFrameMs = Date.now() - started;
    await quiet(page);
    const quietMs = Date.now() - started;
    const { profile } = await session.send('Profiler.stop');
    await session.send('Emulation.setCPUThrottlingRate', { rate:1 });
    if (process.env.PERF_OUT) await writeFile(`${process.env.PERF_OUT}.${round}.cpuprofile`, JSON.stringify(profile));
    results.push({ round, firstFrameMs, quietMs });
    console.log(`startup #${round}: first scene frame ${firstFrameMs} ms, quiet ${quietMs} ms`);
    await session.detach();
  }
  if (process.env.PERF_OUT) await writeFile(process.env.PERF_OUT, JSON.stringify({ date:new Date().toISOString(), books:BOOKS, throttle:THROTTLE, results }, null, 1) + '\n');
});
