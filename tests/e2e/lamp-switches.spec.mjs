import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';

const KEY = 'inhouse-read-shelf-lamps';
const lamps = [
  { key:'lamp:switch-puck', lampId:'mittled', shelf:0, x:.58 },
  { key:'lamp:switch-retro', lampId:'tarnaby', shelf:1, x:.76 },
  { key:'lamp:switch-tripod', lampId:'tripod', shelf:2, x:.72 }
];
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const powerStates = async page => (await saved(page)).map(lamp => lamp.isOn);

async function seedShelf(page) {
  await page.addInitScript(({ key, lamps }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(lamps));
    if (localStorage.getItem('inhouse-read-shelf-type') === null)
      localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-plants', '[]');
  }, { key:KEY, lamps });
  await page.goto(process.env.IHR_TEST_URL || '/');
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, geometry }) => {
    const db = await new Promise(resolve => {
      const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction('books', 'readwrite');
    for (let index = 0; index < 6; index++) transaction.objectStore('books').put({
      id:`switch:${index}`, title:`Libro ${index}`, name:`switch-${index}.pdf`, format:'PDF', sourceType:'local',
      ...geometry,
      mimeType:'application/pdf', pageCount:100, content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      shelfPosition:{ shelf:Math.floor(index / 2), x:index % 2 ? .4 : .25 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise(resolve => { transaction.oncomplete = resolve; }); db.close();
  }, { bytes, geometry:settledGeometryLength(30_000, 'lamp-switches') });
  await page.reload();
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  await expect(page.locator('.ihr-lamp')).toHaveCount(3);
  return scene;
}

async function receiverWarmth(scene) {
  return scene.evaluate(canvas => {
    // Empty receiving surfaces below the puck, excluding the emissive lamp.
    // A power toggle must change reflected light, not merely aria metadata.
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

async function assertResting(scene) {
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  // A pinch can finish before its sharper covers/fonts have decoded. Allow
  // those finite uploads, then require a stable interval and another check.
  await expect.poll(async () => {
    const previous = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(500);
    return await scene.getAttribute('data-snapshot-render-count') === previous;
  }, { timeout:30_000 }).toBe(true);
  const count = await scene.getAttribute('data-snapshot-render-count');
  await scene.page().waitForTimeout(500);
  expect(await scene.getAttribute('data-snapshot-render-count')).toBe(count);
}

test('un toque controla cada luz, ilumina superficies y conserva el estado al recargar y cambiar de estantería', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion:'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const scene = await seedShelf(page);
  const initialWarmth = await receiverWarmth(scene);
  for (const [index, lampId] of ['mittled', 'tarnaby', 'tripod'].entries()) {
    const lamp = page.locator(`.ihr-lamp[data-lamp-id="${lampId}"]`);
    await expect(lamp).toHaveAttribute('aria-pressed', 'true');
    await lamp.tap();
    await expect(lamp).toHaveAttribute('aria-pressed', 'false');
    await expect(lamp).toHaveAttribute('data-lamp-on', 'false');
    await expect(lamp).toHaveAttribute('data-lamp-power', '0.0000');
    await expect(scene).toHaveAttribute('data-active-lamp-lights', String(2 - index));
    expect(await powerStates(page)).toEqual(lamps.map((_, other) => other > index));
  }
  await assertResting(scene);
  expect(initialWarmth - await receiverWarmth(scene)).toBeGreaterThan(10);
  await testInfo.attach('baggebo-tres-luces-apagadas', { body:await page.screenshot(), contentType:'image/png' });
  const offRecords = await saved(page);
  await page.reload();
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  expect(await saved(page)).toEqual(offRecords);
  await expect(scene).toHaveAttribute('data-active-lamp-lights', '0');
  for (const lamp of await page.locator('.ihr-lamp').all()) await expect(lamp).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name:/Abrir catálogo IKEA/ }).click();
  const catalog = page.getByTestId('plant-catalog');
  await expect(catalog).toBeVisible();
  await catalog.getByRole('button', { name:'Estanterías', exact:true }).click();
  await catalog.locator('[data-catalog-shelf="walnut"]').click();
  await catalog.getByRole('button', { name:'Usar', exact:true }).click();
  await expect(catalog).toBeHidden();
  await expect(scene).toHaveAttribute('data-shelf-type', 'walnut');
  expect(await powerStates(page)).toEqual([false, false, false]);
  // The solid walnut ceiling hides this puck from the diagonal camera. Its
  // accessible switch remains usable without allowing taps through the wood.
  const walnutPuck = page.locator('.ihr-lamp[data-lamp-id="mittled"]');
  await walnutPuck.tap();
  await expect(walnutPuck).toHaveAttribute('aria-pressed', 'false');
  expect(await powerStates(page)).toEqual([false, false, false]);
  await walnutPuck.focus();
  await walnutPuck.press('Enter');
  await expect(scene).toHaveAttribute('data-active-lamp-lights', '1');
  expect(await powerStates(page)).toEqual([true, false, false]);
  await page.reload();
  await expect(scene).toHaveAttribute('data-shelf-type', 'walnut');
  await expect(scene).toHaveAttribute('data-active-lamp-lights', '1');
  expect(await powerStates(page)).toEqual([true, false, false]);
  await assertResting(scene);
  expect(errors).toEqual([]);
});

test('la bombilla se toca directamente y los gestos de mantener, cancelar y pellizcar conservan su interruptor', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion:'no-preference' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const scene = await seedShelf(page), lamp = page.locator('.ihr-lamp[data-lamp-id="tarnaby"]');
  const hit = lamp.locator('[data-shelf-lamp-hit]');
  async function bulbPoint() {
    const rect = await hit.boundingBox();
    expect(rect).not.toBeNull();
    return { x:rect.x + rect.width * .5, y:rect.y + rect.height * .42 };
  }
  const bulb = await bulbPoint();
  const base = await lamp.boundingBox();
  // The transparent whole-model target reaches the glass above the base.
  expect(bulb.y).toBeLessThan(base.y);
  await page.touchscreen.tap(bulb.x, bulb.y);
  await expect(lamp).toHaveAttribute('aria-pressed', 'false');
  await expect(lamp).toHaveAttribute('data-lamp-power', '0.0000', { timeout:30_000 });
  expect(await powerStates(page)).toEqual([true, false, true]);
  await assertResting(scene);
  await testInfo.attach('filamentos-apagados', { body:await page.screenshot(), contentType:'image/png' });

  const cdp = await page.context().newCDPSession(page);
  const contact = point => ({ id:1, x:point.x, y:point.y, radiusX:3, radiusY:3, force:1 });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[contact(await bulbPoint())] });
  await page.waitForTimeout(500);
  await expect(lamp).toHaveClass(/is-lifted/);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await expect(lamp).not.toHaveClass(/is-lifted|is-dragging/);
  expect(await powerStates(page)).toEqual([true, false, true]);

  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[contact(await bulbPoint())] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] });
  expect(await powerStates(page)).toEqual([true, false, true]);
  const start = await bulbPoint(), second = { id:2, x:start.x - 80, y:start.y, radiusX:3, radiusY:3, force:1 };
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[contact(start)] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[contact(start), second] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[contact(start), { ...second, x:second.x - 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await expect(scene).toHaveAttribute('data-inspection-moving', 'false', { timeout:30_000 });
  expect(await powerStates(page)).toEqual([true, false, true]);
  await expect(lamp).toHaveAttribute('aria-pressed', 'false');

  const next = await bulbPoint();
  await page.touchscreen.tap(next.x, next.y);
  await expect(lamp).toHaveAttribute('aria-pressed', 'true');
  await expect(lamp).toHaveAttribute('data-lamp-power', '1.0000', { timeout:30_000 });
  expect(await powerStates(page)).toEqual([true, true, true]);
  await assertResting(scene);
  await testInfo.attach('filamentos-encendidos-zoom', { body:await page.screenshot(), contentType:'image/png' });
  // The lamp's enlarged glass target must leave its neighbouring book usable.
  const cover = await page.locator('.ihr-spine[data-shelf-index="1"]').last()
    .locator('[data-shelf-cover-hit]').boundingBox();
  expect(cover).not.toBeNull();
  // Zoom can move the narrow spine beyond the left edge while its cover is
  // still visible. Touch that exposed cover as the user would.
  await page.touchscreen.tap(Math.max(8, Math.min(382, cover.x + cover.width * .8)),
    Math.max(130, Math.min(820, cover.y + cover.height * .5)));
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible({ timeout:30_000 });
  await page.getByRole('button', { name:'Cerrar', exact:true }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 });
  expect(await powerStates(page)).toEqual([true, true, true]);
  await assertResting(scene);
  expect(errors).toEqual([]);
});
