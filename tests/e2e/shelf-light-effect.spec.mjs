import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';
import { watchFrames, waitOnFrameClock } from './helpers/frame-clock.mjs';

test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });

test('la luz cálida ilumina las superficies de nogal y de la BAGGEBO abierta, y la escena descansa', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await watchFrames(page);
  await page.goto(process.env.IHR_TEST_URL || '/');
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, geometry }) => {
    const db = await new Promise(resolve => { const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('books', 'readwrite');
    for (let index = 0; index < 6; index++) transaction.objectStore('books').put({
      id:`illumination:${index}`, title:`Libro ${index}`, name:`light-${index}.pdf`, format:'PDF', sourceType:'local',
      ...geometry,
      mimeType:'application/pdf', pageCount:100, content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      shelfPosition:{ shelf:Math.floor(index / 2), x:index % 2 ? .4 : .25 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise(resolve => { transaction.oncomplete = resolve; }); db.close();
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-plants', '[]');
  }, { bytes, geometry:await settledGeometryLength(30_000, 'shelf-light-effect') });
  const lamps = [
    { key:'lamp:pool', lampId:'mittled', shelf:0, x:.58 },
    { key:'lamp:retro', lampId:'tarnaby', shelf:1, x:.76 },
    { key:'lamp:tripod', lampId:'tripod', shelf:2, x:.72 }
  ];
  const scene = page.locator('.ihr-bookshelf-scene');
  // A reload rebuilds the room. The lamps' lights belong to its first painted
  // frame: the frame that writes data-render-count 1 also writes
  // data-active-lamp-lights, so a lamp lit late shows up as a first frame
  // without it. How long that frame takes is start-up, not lighting: on a
  // software-GL runner its program links block for 4-10 s (SwiftShader has no
  // KHR_parallel_shader_compile) and the compositor then asks for no frames for
  // 5-10 s more with the page idle, so a wall-clock 8 s there timed the runner.
  // The first painted frame is recorded in the page; the room then settles on
  // the page's frame clock (helpers/frame-clock.mjs) within the same 8 s.
  await page.addInitScript(() => {
    new MutationObserver((records, observer) => {
      const canvas = document.querySelector('canvas.ihr-bookshelf-scene');
      if (!canvas?.dataset.renderCount) return;
      observer.disconnect();
      window.firstRoomPaint = { renders:canvas.dataset.renderCount, lampLights:canvas.dataset.activeLampLights ?? null };
    }).observe(document, { subtree:true, childList:true, attributes:true, attributeFilter:['data-render-count'] });
  });
  async function firstPaint(lampLights) {
    await expect.poll(() => page.evaluate(() => window.firstRoomPaint ?? null), { timeout:60_000 }).not.toBeNull();
    expect(await page.evaluate(() => window.firstRoomPaint)).toEqual({ renders:'1', lampLights });
    await waitOnFrameClock([page], () => page.evaluate(() => document.querySelector('canvas.ihr-bookshelf-scene').dataset.animating === 'false'),
      8_000, 'the reloaded room at rest');
    await expect(scene).toHaveAttribute('data-active-lamp-lights', lampLights);
  }
  async function warmth() {
    return scene.evaluate(canvas => {
      // An empty receiving surface below the puck, away from its emissive
      // diffuser, books and bulbs: this measures reflected light, not glow.
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0, count = 0;
      for (let y = Math.floor(canvas.height * .12); y < canvas.height * .18; y++) {
        for (let x = Math.floor(canvas.width * .46); x < canvas.width * .57; x++) {
          const offset = (y * canvas.width + x) * 4;
          if (image.data[offset + 3] > 240) { sum += image.data[offset] - image.data[offset + 2]; count++; }
        }
      }
      return count ? sum / count : 0;
    });
  }
  for (const shelfType of ['baggebo', 'walnut']) {
    await page.evaluate(({ shelfType, lamps }) => {
      localStorage.setItem('inhouse-read-shelf-type', shelfType);
      localStorage.setItem('inhouse-read-shelf-lamps', JSON.stringify(lamps));
    }, { shelfType, lamps });
    await page.reload();
    await firstPaint('3');
    const warm = await warmth();
    await testInfo.attach(`${shelfType}-warm-receivers`, { body:await page.screenshot(), contentType:'image/png' });
    const renders = await scene.getAttribute('data-snapshot-render-count');
    await page.waitForTimeout(500);
    expect(await scene.getAttribute('data-snapshot-render-count')).toBe(renders);
    await page.evaluate(() => localStorage.setItem('inhouse-read-shelf-lamps', '[]'));
    await page.reload();
    await firstPaint('0');
    expect(warm - await warmth()).toBeGreaterThan(10);
  }
  expect(errors).toEqual([]);
});
