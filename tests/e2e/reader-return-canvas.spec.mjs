import { test, expect } from '@playwright/test';
import { adaptiveContentPDF } from './fixtures/pdf-adaptive-content.mjs';

test.use({ viewport:{ width:390, height:845 }, deviceScaleFactor:2, isMobile:true, hasTouch:true });

// Functional ownership/pixel checks, not a timing benchmark: this observer
// reads the exported 2D page deliberately. Original native return contracts
// keep their own uninstrumented clock and unchanged deadlines.
async function observeReturnCanvas(page) {
  await page.evaluate(() => {
    const originalAppend = Element.prototype.append;
    const originalReplace = Element.prototype.replaceChildren;
    const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
    const sourceOf = new WeakMap(), uploads = [];
    const state = { overlay:null, pixels:null, fallback:null, fallbackPixels:null,
      phaseSamples:[], copyDepth:null, uploadParentHeld:false, fallbackParentHeld:false };
    const pixels = canvas => new Uint8Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
      const value = originalDraw.call(this, source, ...args);
      if (source instanceof HTMLCanvasElement) sourceOf.set(this.canvas, source);
      return value;
    };
    Element.prototype.append = function (...children) {
      const value = originalAppend.apply(this, children);
      if (this.classList.contains('ihr-reader-return-page')) {
        const canvas = this.querySelector('canvas');
        if (canvas && !state.overlay) {
          state.overlay = canvas; state.pixels = pixels(canvas);
          let current = canvas, depth = 0;
          while (sourceOf.has(current) && depth < 8 && !current.classList.contains('pdf-page-canvas')) {
            current = sourceOf.get(current); depth++;
          }
          if (current.classList.contains('pdf-page-canvas')) state.copyDepth = depth;
        }
      }
      return value;
    };
    Element.prototype.replaceChildren = function (...children) {
      const value = originalReplace.apply(this, children);
      if (this.classList.contains('ihr-flyout__fallback-pages')) {
        const canvas = this.querySelector('.ihr-flyout__saved-page');
        if (canvas && state.overlay) {
          state.fallback = canvas; state.fallbackPixels = pixels(canvas);
          state.fallbackParentHeld = state.overlay.parentElement?.classList.contains('ihr-reader-return-page') === true
            && state.overlay.isConnected && !document.body.classList.contains('is-reader-page-leaving');
        }
      }
      return value;
    };
    const prototypes = [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype].filter(Boolean);
    for (const prototype of new Set(prototypes)) for (const method of ['texImage2D', 'texSubImage2D']) {
      const original = prototype[method];
      prototype[method] = function (...args) {
        const source = args.find(value => value instanceof HTMLCanvasElement);
        if (source) {
          uploads.push(source);
          if (source === state.overlay) state.uploadParentHeld = source.isConnected
            && source.parentElement?.classList.contains('ihr-reader-return-page') === true
            && !document.body.classList.contains('is-reader-page-leaving');
        }
        return original.apply(this, args);
      };
    }
    const observer = new MutationObserver(() => {
      const flyout = document.querySelector('.ihr-flyout--return');
      const phase = flyout?.dataset.returnPhase;
      if (phase && !state.phaseSamples.includes(phase)) state.phaseSamples.push(phase);
    });
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-return-phase'] });
    const equal = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => value === b[index]));
    window.__returnCanvasFacts = () => {
      observer.disconnect();
      const current = state.overlay && pixels(state.overlay);
      return {
        overlayFound:Boolean(state.overlay), width:state.overlay?.width, height:state.overlay?.height,
        retainedPixels:equal(state.pixels, current), originalByteLength:state.pixels?.byteLength,
        physicallyPainted:state.pixels?.some((value, index) => index % 4 === 3 && value > 0),
        sameTextureSource:uploads.includes(state.overlay), uploadParentHeld:state.uploadParentHeld,
        fallbackFound:Boolean(state.fallback), fallbackDistinct:state.fallback !== state.overlay,
        fallbackParentHeld:state.fallbackParentHeld, fallbackPixelsEqual:equal(state.pixels, state.fallbackPixels),
        overlayCopyDepth:state.copyDepth, phases:state.phaseSamples,
        overlayConnected:state.overlay?.isConnected,
        leakedLayers:document.querySelectorAll('.ihr-reader-return-page,.ihr-flyout--return').length
      };
    };
  });
}

for (const mode of ['pdf-native', 'pdf-fallback', 'adaptive-native', 'epub-native']) {
  test(`the real ${mode} return preserves the snapshot without a second still-page copy`, async ({ page }, testInfo) => {
    // Includes cold application boot/import, complete word counting and a
    // real non-reduced 3D close. It does not replace any existing speed test.
    test.setTimeout(90_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion:'no-preference' });
    if (mode === 'pdf-fallback') await page.addInitScript(() => {
      window.WebGLRenderingContext = undefined; window.WebGL2RenderingContext = undefined;
    });
    if (mode === 'adaptive-native') await page.addInitScript(() => {
      localStorage.setItem('inhouse-read-reading-preferences', JSON.stringify({ pdfMode:'text', theme:'sepia' }));
    });
    await page.goto(process.env.IHR_TEST_URL || '/');
    const name = mode === 'adaptive-native' ? 'return-canvas-illustrated.pdf'
      : mode === 'epub-native' ? 'reading-journey.epub' : 'tiny.pdf';
    await page.locator('#file-picker').setInputFiles(mode === 'adaptive-native'
      ? { name, mimeType:'application/pdf', buffer:adaptiveContentPDF() }
      : `tests/e2e/fixtures/${name}`);
    await expect(page.locator(mode === 'epub-native' ? 'foliate-view'
      : mode === 'adaptive-native' ? '.pdf-reflow-page' : '.pdf-page-canvas')).toBeVisible();
    if (mode === 'adaptive-native') await expect(page.locator('.pdf-reflow-image')).toHaveCount(2);
    await expect.poll(() => page.evaluate(name => new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, read = db.transaction('books', 'readonly').objectStore('books').getAll();
        read.onerror = () => { db.close(); reject(read.error); };
        read.onsuccess = () => {
          const book = read.result.find(record => record.name === name); db.close();
          resolve(Boolean(book?.wordCountComplete && book.wordCountVersion === 2 && book.contentRevision
            && book.wordCountContentRevision === book.contentRevision));
        };
      };
    }), name), { timeout:20_000 }).toBe(true);
    await observeReturnCanvas(page);
    await page.locator('#reader-back').click();
    await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/, { timeout:30_000 });
    const facts = await page.evaluate(() => window.__returnCanvasFacts());
    await testInfo.attach('reader-return-canvas-ownership', { body:JSON.stringify({ mode, ...facts }), contentType:'application/json' });
    expect(errors).toEqual([]);
    expect(facts.overlayFound && facts.retainedPixels && facts.physicallyPainted).toBe(true);
    expect(facts.originalByteLength).toBe(facts.width * facts.height * 4);
    expect(facts.overlayConnected).toBe(false); expect(facts.leakedLayers).toBe(0);
    expect(facts.phases).toContain('zooming'); expect(facts.phases).toContain('closing');
    if (mode.startsWith('pdf-')) expect(facts.overlayCopyDepth).toBe(1);
    if (mode === 'pdf-fallback') {
      expect(facts.fallbackFound && facts.fallbackDistinct && facts.fallbackParentHeld && facts.fallbackPixelsEqual).toBe(true);
      expect(facts.sameTextureSource).toBe(false);
    } else {
      expect(facts.sameTextureSource && facts.uploadParentHeld).toBe(true);
      expect(facts.fallbackFound).toBe(false);
    }
  });
}
