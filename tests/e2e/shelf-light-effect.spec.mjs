import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';

test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });

test('la luz cálida ilumina las superficies de nogal y de la BAGGEBO abierta, y la escena descansa', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
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
  }, { bytes, geometry:settledGeometryLength(30_000, 'shelf-light-effect') });
  const lamps = [
    { key:'lamp:pool', lampId:'mittled', shelf:0, x:.58 },
    { key:'lamp:retro', lampId:'tarnaby', shelf:1, x:.76 },
    { key:'lamp:tripod', lampId:'tripod', shelf:2, x:.72 }
  ];
  const scene = page.locator('.ihr-bookshelf-scene');
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
    await expect(scene).toHaveAttribute('data-active-lamp-lights', '3');
    await expect(scene).toHaveAttribute('data-animating', 'false');
    const warm = await warmth();
    await testInfo.attach(`${shelfType}-warm-receivers`, { body:await page.screenshot(), contentType:'image/png' });
    const renders = await scene.getAttribute('data-snapshot-render-count');
    await page.waitForTimeout(500);
    expect(await scene.getAttribute('data-snapshot-render-count')).toBe(renders);
    await page.evaluate(() => localStorage.setItem('inhouse-read-shelf-lamps', '[]'));
    await page.reload();
    await expect(scene).toHaveAttribute('data-active-lamp-lights', '0');
    await expect(scene).toHaveAttribute('data-animating', 'false');
    expect(warm - await warmth()).toBeGreaterThan(10);
  }
  expect(errors).toEqual([]);
});
