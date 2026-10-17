import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';
import { spinePointerPosition } from './helpers/shelf-pointer.mjs';

const BOOK_ID = 'font-readiness:tiny-real-pdf';
const FONT_FILE = 'src/assets/fonts/playfair-display-latin-e0c764a8e9e1.woff2';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fontPattern = /\/playfair-display-latin-(?!ext-)[\w-]+\.woff2(?:\?.*)?$/;

test.use({ viewport:{ width:390, height:845 }, deviceScaleFactor:2, isMobile:true, hasTouch:true, serviceWorkers:'block' });

test('the first shelf frame already has its real font and photo, and keeps the same tap target', async ({ page }, testInfo) => {
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  const originalFont = await readFile(FONT_FILE), fontResponses = [], routeErrors = [], pageErrors = [];
  let releaseFont;
  const held = new Promise(resolve => { releaseFont = resolve; });
  page.on('pageerror', error => pageErrors.push(error.message));
  // Fetch the real deployment's WOFF2. Only delivery is held; its actual bytes
  // and response headers are preserved, with no scene or renderer replacement.
  const holdFont = async route => {
    try {
      const response = await route.fetch(), body = await response.body();
      fontResponses.push({ url:route.request().url(), status:response.status(), bytes:body.length, sha256:sha256(body) });
      await held;
      await route.fulfill({ response, body });
    } catch (error) {
      routeErrors.push(error.message);
      await route.abort().catch(() => {});
    }
  };
  await page.route(fontPattern, holdFont);
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.addInitScript(({ bytes, id, geometry }) => {
    const draws = [], originalFillText = CanvasRenderingContext2D.prototype.fillText;
    // Observe real canvas lettering without changing its rasterization. The
    // explicit spine title cannot be confused with the cover's printed title.
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (String(args[0]) === 'Late Font') draws.push({ text:args[0], font:this.font,
        loaded:document.fonts.check('700 24px "Playfair Display"'), status:document.fonts.status });
      return originalFillText.apply(this, args);
    };
    window.__lateShelfFontDraws = draws;
    window.__startupAuthorDraws = [];
    const beforeAuthorText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (String(args[0]) === 'Autora de prueba') window.__startupAuthorDraws.push({ font:this.font,
        loaded:document.fonts.check('500 20px "DM Sans"') });
      return beforeAuthorText.apply(this, args);
    };
    window.__startupCoverFallbacks = 0;
    window.__startupShelfInstances = 0;
    window.__startupPhotos = 0;
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (args[0] instanceof HTMLImageElement && args[0].naturalWidth === 600 && args[0].naturalHeight === 400) window.__startupPhotos++;
      return originalDrawImage.apply(this, args);
    };
    const observe = result => {
      const instance = result.instance || result, actual = instance.exports;
      if (!actual.book_cover_case) return result;
      window.__startupShelfInstances++;
      const exports = { ...actual, book_cover_case(...args) {
        window.__startupCoverFallbacks++; return actual.book_cover_case(...args);
      } };
      const proxy = new Proxy(instance, { get(target, key) { return key === 'exports' ? exports : Reflect.get(target, key, target); } });
      return result.instance ? { ...result, instance:proxy } : proxy;
    };
    for (const name of ['instantiate', 'instantiateStreaming']) if (WebAssembly[name]) {
      const original = WebAssembly[name];
      WebAssembly[name] = async function (...args) { return observe(await Reflect.apply(original, WebAssembly, args)); };
    }
    const image = document.createElement('canvas'); image.width = 600; image.height = 400;
    const context = image.getContext('2d');
    context.fillStyle = '#41695d'; context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#e3bc78'; context.fillRect(0, 250, 600, 150);
    context.fillStyle = '#fffaf0'; context.font = 'bold 40px Georgia';
    context.fillText('Inhouse Read test PDF', 30, 110);
    const encoded = atob(image.toDataURL('image/png').split(',')[1]);
    const cover = new Blob([Uint8Array.from(encoded, value => value.charCodeAt(0))], { type:'image/png' });
    const title = 'Inhouse Read test PDF';
    const book = { id, title, author:'Autora de prueba', name:'tiny.pdf', ...geometry,
      format:'PDF', mimeType:'application/pdf', sourceType:'local',
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }),
      cover, pageCount:1, shelfOrder:0, addedAt:Date.now(), progressFraction:0,
      coverAppearance:{ color:'#41695d', shade:'#2b463d', ink:'#fffaf0', aspectRatio:1.5,
        fontFamily:'Playfair Display', fontCanvasFamily:'Playfair Display', source:'cover' },
      coverAppearanceKey:`${id}|${title}|${cover.type}|${cover.size}|`,
      spineColorOverride:'#41695d', spineTitleOverride:'Late Font', spineFontFamily:'Playfair Display' };
    window.__lateShelfFixtureReady = new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        const books = db.createObjectStore('books', { keyPath:'id' }); books.createIndex('lastOpenedAt', 'lastOpenedAt');
        db.createObjectStore('removed-books', { keyPath:'id' }); books.put(book);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Font fixture database upgrade blocked'));
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('books', 'readonly').objectStore('books').get(id);
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = () => { const saved = read.result; db.close();
          if (saved?.content?.size !== bytes.length) reject(new Error('Font fixture bytes were not committed'));
          else resolve(); };
      };
    });
  }, { bytes, id:BOOK_ID, geometry:await settledGeometryLength(300_000, BOOK_ID) });

  try {
    // A real delayed WOFF2 must never paint temporary letters. Wait beyond
    // the old one-second matcher cutoff, then deliver the original font bytes.
    await page.goto(process.env.IHR_TEST_URL || './', { waitUntil:'domcontentloaded' });
    await page.evaluate(() => window.__lateShelfFixtureReady);
    const spine = page.locator(`.ihr-spine[data-book-id="${BOOK_ID}"]`), scene = page.locator('.ihr-bookshelf-scene');
    await expect.poll(() => fontResponses.length).toBeGreaterThan(0);
    await page.waitForTimeout(1300);
    await expect(spine).toHaveCount(0);
    expect(await page.evaluate(() => window.__lateShelfFontDraws)).toEqual([]);
    expect(routeErrors).toEqual([]);
    for (const response of fontResponses) expect(response).toMatchObject({ status:200, bytes:originalFont.length, sha256:sha256(originalFont) });
    releaseFont();
    await expect(spine).toBeVisible();
    await expect(scene).toHaveAttribute('data-render-count', /[1-9]\d*/);
    await expect.poll(() => page.evaluate(() => window.__lateShelfFontDraws.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__lateShelfFontDraws.every(draw => draw.loaded && /Playfair Display/.test(draw.font)))).toBe(true);
    expect(await page.evaluate(() => window.__startupAuthorDraws.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__startupAuthorDraws.every(draw => draw.loaded))).toBe(true);
    expect(await page.evaluate(() => window.__startupShelfInstances)).toBe(1);
    expect(await page.evaluate(() => window.__startupPhotos)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__startupCoverFallbacks)).toBe(0);
    await page.screenshot({ path:testInfo.outputPath('first-correct-shelf.png') });
    await spine.focus();
    const before = await spine.evaluate(node => {
      const stage = node.closest('.ihr-shelf-stage'), scene = stage.querySelector('.ihr-bookshelf-scene');
      const buttons = [...stage.querySelectorAll('button')];
      window.__lateShelfNodes = { node, stage, scene, buttons };
      window.__lateShelfReadyResolved = false;
      document.fonts.ready.then(() => { window.__lateShelfReadyResolved = true; });
      const rect = node.getBoundingClientRect();
      return { fonts:document.fonts.status, focused:document.activeElement === node,
        rect:{ x:rect.x, y:rect.y, width:rect.width, height:rect.height },
        modelCreations:Number(scene.dataset.modelCreations), renderCount:Number(scene.dataset.renderCount),
        drawCount:window.__lateShelfFontDraws.length };
    });
    expect(before.fonts).toBe('loaded'); expect(before.focused).toBe(true);
    expect(before.rect.width).toBeGreaterThan(0); expect(before.rect.height).toBeGreaterThan(0);
    expect(before.modelCreations).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const after = await spine.evaluate(node => {
      const saved = window.__lateShelfNodes, stage = node.closest('.ihr-shelf-stage'), scene = stage.querySelector('.ihr-bookshelf-scene');
      const rect = node.getBoundingClientRect(), buttons = [...stage.querySelectorAll('button')];
      return { fonts:document.fonts.status, readyResolved:window.__lateShelfReadyResolved,
        sameNode:node === saved.node, sameStage:stage === saved.stage, sameScene:scene === saved.scene,
        sameButtons:buttons.length === saved.buttons.length && buttons.every((button, index) => button === saved.buttons[index]),
        connected:saved.node.isConnected, focused:document.activeElement === saved.node,
        modelCreations:Number(scene.dataset.modelCreations), rect:{ x:rect.x, y:rect.y, width:rect.width, height:rect.height },
        draws:window.__lateShelfFontDraws };
    });
    await testInfo.attach('real-late-font-readiness', { body:JSON.stringify({ fontResponses, before, after, routeErrors, pageErrors }, null, 2), contentType:'application/json' });
    expect(after).toMatchObject({ fonts:'loaded', readyResolved:true, sameNode:true, sameStage:true,
      sameScene:true, sameButtons:true, connected:true, focused:true, modelCreations:before.modelCreations });
    expect(Object.values(after.rect).every(Number.isFinite)).toBe(true);
    expect(after.rect.width).toBeGreaterThan(0); expect(after.rect.height).toBeGreaterThan(0);
    const bounds = await spine.boundingBox(); expect(bounds).not.toBeNull();
    await spine.tap({ position:await spinePointerPosition(spine, bounds) });
    const cover = page.locator('.ihr-flyout__cover-target');
    await expect(cover).toBeVisible(); await expect(page.locator('.ihr-flyout__readiness')).toHaveText('Listo para leer');
    await cover.tap(); await expect(page.locator('.pdf-page-canvas')).toBeVisible();
    expect(routeErrors).toEqual([]); expect(pageErrors).toEqual([]);
  } finally {
    releaseFont();
    await page.unroute(fontPattern, holdFont);
  }
});
