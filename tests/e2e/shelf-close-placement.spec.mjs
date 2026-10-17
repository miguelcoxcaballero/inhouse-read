import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';
import { readTables } from '../../src/js/core-tables.js';

const PLANTS = 'inhouse-read-shelf-plants';
const LAMPS = 'inhouse-read-shelf-lamps';
const PHYSICS = 'inhouse-read-shelf-physics-v1';
const MOVED = 'plant:close-cactus';
const NEIGHBOUR = 'plant:close-monstera';
const movedPoseKey = `plant:${MOVED}`;
const neighbourPoseKey = `plant:${NEIGHBOUR}`;
const object = (page, key) => page.locator(`[data-object-id="${key}"]`);

test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });

async function settled(page) {
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  await expect(scene).toHaveAttribute('data-book-quality-pending', '0', { timeout:30_000 });
  await expect.poll(() => page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved?.[2]?.length;
  }, PHYSICS), { timeout:30_000 }).toBe(4);
  await expect.poll(async () => {
    const count = await scene.getAttribute('data-render-count');
    await page.waitForTimeout(400);
    return count === await scene.getAttribute('data-render-count');
  }, { timeout:30_000 }).toBe(true);
  return scene;
}

async function state(page) {
  return page.evaluate(({ plants, lamps, physics }) => ({
    slots:[...document.querySelectorAll('[data-object-id]')].map(node => ({
      id:node.dataset.objectId, shelf:node.dataset.shelfIndex, x:node.dataset.shelfX
    })).sort((a,b) => a.id.localeCompare(b.id)),
    plants:JSON.parse(localStorage.getItem(plants)),
    lamps:JSON.parse(localStorage.getItem(lamps)),
    poses:JSON.parse(localStorage.getItem(physics))[2]
  }), { plants:PLANTS, lamps:LAMPS, physics:PHYSICS });
}

async function seed(page, { bookShelf = 1 } = {}) {
  await page.goto(process.env.IHR_TEST_URL || '/');
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  const geometry = await settledGeometryLength(32_000, 'close-placement');
  const { instance } = await WebAssembly.instantiate(await readFile('src/wasm/inhouse_read_decor.wasm'));
  const { dimensions } = readTables(instance.exports, 'plant_catalogue_json');
  const sizes = { cactus:dimensions.cactus.akerbar, monstera:dimensions.monstera.gradvis };
  await page.evaluate(async ({ bytes, geometry, plants, lamps, bookShelf, sizes }) => {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('books', 'readwrite');
    transaction.objectStore('books').put({
      id:'close:sentinel', title:'Quiet corners', name:'close-sentinel.pdf', format:'PDF',
      sourceType:'local', mimeType:'application/pdf', pageCount:100, ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      shelfPosition:{ shelf:bookShelf, x:.15 }, shelfOrder:0,
      addedAt:Date.now(), lastOpenedAt:Date.now(), progressFraction:0
    });
    await new Promise((resolve,reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); db.close();
    localStorage.setItem('inhouse-read-shelf-view', 'spine');
    localStorage.setItem('inhouse-read-shelf-type', 'walnut');
    localStorage.setItem(plants, JSON.stringify([
      { key:'plant:close-cactus', seed:'close-cactus', catalogId:'cactus', variant:'cactus', potId:'akerbar',
        width:sizes.cactus.width, height:sizes.cactus.height, shelf:0, x:.2 },
      { key:'plant:close-monstera', seed:'close-monstera', catalogId:'monstera', variant:'monstera', potId:'gradvis',
        width:sizes.monstera.width, height:sizes.monstera.height, shelf:0, x:.72 }
    ]));
    localStorage.setItem(lamps, JSON.stringify([
      { key:'lamp:close-tripod', seed:'lamp:close-tripod', lampId:'tripod', shelf:1, x:.72, isOn:true }
    ]));
  }, { bytes, geometry, plants:PLANTS, lamps:LAMPS, bookShelf, sizes });
  await page.reload();
  await expect(page.locator('.ihr-spine')).toHaveCount(1);
  await expect(page.locator('.ihr-plant')).toHaveCount(2);
  await expect(page.locator('.ihr-lamp')).toHaveCount(1);
  const scene = await settled(page);
  await expect(scene).toHaveAttribute('data-shelf-type', 'walnut');
  await expect(scene).toHaveAttribute('data-view-progress', '0');
  return scene;
}

test('pots fit close under a wide canopy without moving other objects or separating on reload', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Read the same compiled catalogue used by the app, after discovery/build.
  // Pot proportions must not silently diverge from an updated catalogue.
  const { instance } = await WebAssembly.instantiate(await readFile('src/wasm/inhouse_read_decor.wasm'));
  const { dimensions } = readTables(instance.exports, 'plant_catalogue_json');
  const cactusSize = dimensions.cactus.akerbar, monsteraSize = dimensions.monstera.gradvis;
  const scene = await seed(page), before = await state(page);
  const selected = object(page, MOVED), neighbour = object(page, NEIGHBOUR);
  const source = await selected.boundingBox(), adjacent = await neighbour.boundingBox();
  expect(source).not.toBeNull(); expect(adjacent).not.toBeNull();
  // These native hit rectangles surround the actual ceramic/metal pots,
  // not their foliage. Aim for a small positive visible gap, inside the
  // obsolete full-canopy placement interval, using the measured front view.
  const start = { x:source.x + source.width / 2, y:source.y + source.height * .65 };
  const target = { x:adjacent.x - source.width / 2 - 1.5, y:start.y };
  expect(target.x - start.x).toBeGreaterThan(20);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await expect(selected).toHaveClass(/is-lifted/);
  for (const fraction of [.25, .5, .75, 1]) {
    await page.mouse.move(start.x + (target.x - start.x) * fraction, target.y, { steps:3 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await expect(scene).toHaveAttribute('data-drop-shelf', '0');
  const previewX = Number(await scene.getAttribute('data-drop-x'));
  await page.mouse.up(); await settled(page);
  const after = await state(page);
  const stored = after.plants.find(plant => plant.key === MOVED);
  expect(stored.shelf).toBe(0); expect(stored.x).toBeCloseTo(previewX, 3);
  expect(stored.x).toBeGreaterThan(before.plants.find(plant => plant.key === MOVED).x + .12);
  for (const old of before.slots.filter(slot => slot.id !== MOVED))
    expect(after.slots.find(slot => slot.id === old.id)).toEqual(old);
  expect(after.lamps).toEqual(before.lamps);

  const cactus = after.poses.find(row => row[0] === movedPoseKey);
  const monstera = after.poses.find(row => row[0] === neighbourPoseKey);
  expect(cactus).toBeDefined(); expect(monstera).toBeDefined();
  // Catalogue proportions remain valid when the tall plant is fitted into
  // its bay. Saved native solver lengths are metres, including the fit.
  const cactusRadius = cactus[3][1] * cactusSize.potDiameter / cactusSize.height / 2;
  const monsteraRadius = monstera[3][1] * monsteraSize.potDiameter / monsteraSize.height / 2;
  const gap = Math.abs(cactus[5] - monstera[5]) - cactusRadius - monsteraRadius;
  expect(gap, 'actual solid pots must neither penetrate nor reserve empty foliage').toBeGreaterThan(-.0015);
  expect(gap, 'the pots must be allowed within four millimetres').toBeLessThan(.004);
  const nominalOverlap = (cactus[3][0] + monstera[3][0]) / 2 - Math.abs(cactus[5] - monstera[5]);
  expect(nominalOverlap, 'exercise the formerly forbidden canopy interval').toBeGreaterThan(.02);
  for (const pose of [cactus, monstera])
    expect(Math.abs(pose[6] - pose[3][1] / 2 - pose[4][2]), 'both pots rest on the board').toBeLessThan(.002);
  for (const old of before.poses.filter(row => row[0] !== movedPoseKey)) {
    const actual = after.poses.find(row => row[0] === old[0]);
    for (const component of [5, 6, 7]) expect(actual[component]).toBeCloseTo(old[component], 6);
  }
  await page.reload(); await settled(page);
  const reopened = await state(page);
  expect(reopened.slots).toEqual(after.slots);
  expect(reopened.plants).toEqual(after.plants); expect(reopened.lamps).toEqual(after.lamps);
  for (const old of after.poses) {
    const actual = reopened.poses.find(row => row[0] === old[0]);
    for (const component of [5, 6, 7]) expect(actual[component]).toBeCloseTo(old[component], 6);
  }
  expect(errors).toEqual([]);
  await testInfo.attach('close-pot-placement', {
    body:JSON.stringify({ start, target, previewX, gap, nominalOverlap, before, after, reopened }, null, 2),
    contentType:'application/json'
  });
  await testInfo.attach('close-pots-restored', { body:await page.screenshot(), contentType:'image/png' });
});

test('keyboard placement creates the next cabinet and persists without moving existing neighbours', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page, { bookShelf:2 });
  const selectedKey = 'book:close:sentinel';
  const selected = object(page, selectedKey), before = await state(page);
  await expect(selected).toHaveAttribute('data-shelf-index', '2');
  const previous = before.slots.find(slot => slot.id === selectedKey);

  async function storedPosition() {
    return page.evaluate(async () => {
      const db = await new Promise((resolve,reject) => {
        const request = indexedDB.open('inhouse-read');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const book = await new Promise((resolve,reject) => {
        const request = db.transaction('books').objectStore('books').get('close:sentinel');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      }); db.close();
      return book.shelfPosition;
    });
  }

  // Row 2 is the bottom of the original three-bay cabinet. Keyboard movement
  // must allow row 3 to be created before its physical colliders exist.
  await selected.focus(); await expect(selected).toBeFocused();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(selected).toHaveAttribute('data-shelf-index', '3');
  await settled(page);
  await expect.poll(storedPosition).toMatchObject({ shelf:3 });
  const saved = await storedPosition(), after = await state(page);
  expect(saved.x).toBeCloseTo(Number(previous.x), 8);
  await expect(selected).toBeFocused();
  expect(after.plants).toEqual(before.plants); expect(after.lamps).toEqual(before.lamps);
  for (const old of before.slots.filter(slot => slot.id !== selectedKey))
    expect(after.slots.find(slot => slot.id === old.id)).toEqual(old);
  for (const old of before.poses.filter(row => row[0] !== selectedKey)) {
    const actual = after.poses.find(row => row[0] === old[0]);
    for (const component of [5, 6, 7]) expect(actual[component]).toBeCloseTo(old[component], 6);
  }

  await page.reload(); await settled(page);
  await expect(selected).toHaveAttribute('data-shelf-index', '3');
  expect(await storedPosition()).toEqual(saved);
  const reopened = await state(page);
  expect(reopened.slots).toEqual(after.slots);
  expect(reopened.plants).toEqual(after.plants); expect(reopened.lamps).toEqual(after.lamps);
  for (const old of after.poses) {
    const actual = reopened.poses.find(row => row[0] === old[0]);
    for (const component of [5, 6, 7]) expect(actual[component]).toBeCloseTo(old[component], 6);
  }
  expect(errors).toEqual([]);
  await testInfo.attach('keyboard-next-cabinet', {
    body:JSON.stringify({ saved, before, after, reopened }, null, 2), contentType:'application/json'
  });
});
