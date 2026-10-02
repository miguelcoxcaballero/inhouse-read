import { expect, test } from '@playwright/test';

const BOOK_ID = 'finish:controlled-blue';
const LAMP_KEY = 'inhouse-read-shelf-lamps';
const FINISHES = ['matte', 'satin', 'glossy'];
const FINISH_CONTROLS = ['Brillo de la portada', 'Brillo del canto', 'Brillo del lomo'];
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });

// The real PDF and saved thumbnail must agree: opening a book extracts its
// actual first page and dimensions. A white tiny.pdf behind a blue thumbnail
// would change the artwork and book size in the middle of a finish comparison.
function blueCoverPdf() {
  const pages = 400, streamId = pages + 3, fontId = pages + 4;
  const paint = '0.094118 0.211765 0.294118 rg 0 0 400 600 re f\n' +
    '0.894118 0.905882 0.870588 rg BT /F1 36 Tf 76 488 Td (LUZ Y PAPEL) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length:pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...Array.from({ length:pages }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`),
    `<< /Length ${paint.length} >>\nstream\n${paint}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...new TextEncoder().encode(pdf)];
}

async function readBook(page) {
  return page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const book = await new Promise((resolve, reject) => {
      const request = db.transaction('books', 'readonly').objectStore('books').get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    db.close();
    return { cover:book.coverFinish, spine:book.spineSurfaceFinish, edge:book.pageEdgeFinish };
  }, BOOK_ID);
}

async function assertResting(scene) {
  // Remote font downloads may finish after the flyout closes and invalidate
  // its shelf copy once. Resolve those finite uploads before judging idle.
  await scene.page().evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  // Cover/font decodes may finish after an insertion. Allow finite uploads,
  // then require a second quiet interval; a permanent repaint loop fails.
  await expect.poll(async () => {
    const count = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(500);
    const middle = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(500);
    return count === middle && middle === await scene.getAttribute('data-snapshot-render-count');
  }, { timeout:30_000 }).toBe(true);
  const count = await scene.getAttribute('data-snapshot-render-count');
  await scene.page().waitForTimeout(500);
  expect(await scene.getAttribute('data-snapshot-render-count')).toBe(count);
}

async function sample(scene, rect) {
  return scene.evaluate((canvas, rect) => {
    const frame = canvas.getBoundingClientRect(), scaleX = canvas.width / frame.width, scaleY = canvas.height / frame.height;
    const x = Math.max(0, Math.floor((rect.x - frame.x) * scaleX));
    const y = Math.max(0, Math.floor((rect.y - frame.y) * scaleY));
    const width = Math.min(canvas.width - x, Math.ceil(rect.width * scaleX));
    const height = Math.min(canvas.height - y, Math.ceil(rect.height * scaleY));
    const image = canvas.getContext('2d').getImageData(x, y, width, height);
    return { width, height, pixels:[...image.data] };
  }, rect);
}

// A mask from the unlit dark-blue binding/cover excludes the white shelves,
// warm wall, printed lettering and the lamp itself. All comparisons use the
// same pixel coordinates of the same book, rather than a whole-page image.
function blueMask(image) {
  const mask = [];
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const [r, g, b, a] = image.pixels.slice(offset, offset + 4);
    if (a > 240 && b > 25 && b > r + 10 && b > g + 4) mask.push(offset);
  }
  return mask;
}

function difference(a, b, mask) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let total = 0;
  for (const offset of mask)
    for (let channel = 0; channel < 3; channel++) total += Math.abs(a.pixels[offset + channel] - b.pixels[offset + channel]);
  return total / (mask.length * 3);
}

function lightResponse(on, off, mask) {
  const highlights = [], warmHighlights = [];
  let warm = 0;
  for (const offset of mask) {
    const dr = on.pixels[offset] - off.pixels[offset], dg = on.pixels[offset + 1] - off.pixels[offset + 1];
    const db = on.pixels[offset + 2] - off.pixels[offset + 2];
    warm += dr - db;
    warmHighlights.push(dr - db);
    highlights.push(.2126 * dr + .7152 * dg + .0722 * db);
  }
  highlights.sort((a, b) => a - b);
  warmHighlights.sort((a, b) => a - b);
  return {
    warmth:warm / mask.length,
    warmHighlight95:warmHighlights[Math.floor(warmHighlights.length * .95)],
    highlight95:highlights[Math.floor(highlights.length * .95)],
    highlightCoverage:highlights.filter(value => value > 6).length / mask.length,
    rgbDifference:difference(on, off, mask)
  };
}

test('mate, satinado y brillante cambian el libro real en la estantería, reflejan la lámpara y conservan el acabado', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.emulateMedia({ reducedMotion:'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.WebGLProgram|VALIDATE_STATUS|shader.*(?:compil|link)|GL_INVALID/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(process.env.IHR_TEST_URL || './');
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = blueCoverPdf();
  await page.evaluate(async ({ bytes, id, lampKey }) => {
    const cover = document.createElement('canvas'); cover.width = 400; cover.height = 600;
    const context = cover.getContext('2d'); context.fillStyle = '#18364b'; context.fillRect(0, 0, 400, 600);
    context.fillStyle = '#e4e7de'; context.font = '36px serif'; context.textAlign = 'center';
    context.fillText('LUZ Y PAPEL', 200, 112);
    const coverBlob = await new Promise(resolve => cover.toBlob(resolve, 'image/png'));
    const db = await new Promise(resolve => { const request = indexedDB.open('inhouse-read'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('books', 'readwrite');
    transaction.objectStore('books').put({
      id, title:'Luz y papel', name:'finish.pdf', format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:400,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:coverBlob,
      shelfPosition:{ shelf:0, x:.46 }, shelfOrder:0, addedAt:Date.now(), lastOpenedAt:Date.now(), progressFraction:0,
      spineColorOverride:'#18364b', coverFinish:'matte', spineSurfaceFinish:'matte', pageEdgeFinish:'matte'
    });
    await new Promise(resolve => { transaction.oncomplete = resolve; }); db.close();
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem('inhouse-read-shelf-plants', '[]');
    localStorage.setItem(lampKey, JSON.stringify([{ key:'lamp:finish-retro', lampId:'tarnaby', shelf:0, x:.72, isOn:false }]));
  }, { bytes, id:BOOK_ID, lampKey:LAMP_KEY });
  await page.reload();
  const scene = page.locator('.ihr-bookshelf-scene'), spine = page.locator(`.ihr-spine[data-book-id="${BOOK_ID}"]`);
  const lamp = page.locator('.ihr-lamp[data-lamp-id="tarnaby"]');
  await expect(spine).toBeVisible(); await assertResting(scene);
  // Resolve the actual document cover/layout before fixing pixel coordinates.
  await spine.tap(); await expect(page.locator('.ihr-flyout__book')).toBeVisible();
  await page.getByRole('button', { name:'Cerrar', exact:true }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0); await assertResting(scene);
  const spineRect = await spine.boundingBox(), coverRect = await spine.locator('[data-shelf-cover-hit]').boundingBox();
  expect(spineRect).not.toBeNull(); expect(coverRect).not.toBeNull();
  const baselineSpine = await sample(scene, spineRect), baselineCover = await sample(scene, coverRect);
  const masks = { spine:blueMask(baselineSpine), cover:blueMask(baselineCover) };
  expect(masks.spine.length).toBeGreaterThan(40); expect(masks.cover.length).toBeGreaterThan(100);
  const views = {}, metrics = { maskPixels:{ spine:masks.spine.length, cover:masks.cover.length }, finishes:{} };

  for (const finish of FINISHES) {
    if (finish !== 'matte') {
      await spine.tap(); await page.getByRole('button', { name:'Editar', exact:true }).click();
      for (const label of FINISH_CONTROLS) await page.getByLabel(label, { exact:true }).selectOption(finish);
      await expect.poll(() => readBook(page)).toEqual({ cover:finish, spine:finish, edge:finish });
      await page.getByRole('button', { name:'Listo', exact:true }).click();
      await page.getByRole('button', { name:'Cerrar', exact:true }).click();
      await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 });
    }
    await expect(lamp).toHaveAttribute('aria-pressed', 'false'); await assertResting(scene);
    const currentSpine = await spine.boundingBox(), currentCover = await spine.locator('[data-shelf-cover-hit]').boundingBox();
    for (const field of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(currentSpine[field] - spineRect[field]), `El lomo debe mantener ${field} al cambiar solo el acabado`).toBeLessThan(1);
      expect(Math.abs(currentCover[field] - coverRect[field]), `La portada debe mantener ${field} al cambiar solo el acabado`).toBeLessThan(1);
    }
    const off = { spine:await sample(scene, spineRect), cover:await sample(scene, coverRect) };
    // A strong neutral window reflection desaturates glossy blue stock.
    // Require a substantial remaining blue base, without discarding the
    // highlight pixels we are explicitly trying to measure.
    expect(blueMask(off.spine).length).toBeGreaterThan(masks.spine.length * .3);
    expect(blueMask(off.cover).length).toBeGreaterThan(masks.cover.length * .3);
    await lamp.tap(); await expect(lamp).toHaveAttribute('data-lamp-power', '1.0000');
    await expect(scene).toHaveAttribute('data-active-lamp-lights', '1'); await assertResting(scene);
    const on = { spine:await sample(scene, spineRect), cover:await sample(scene, coverRect) };
    views[finish] = { on, off };
    metrics.finishes[finish] = {
      spine:lightResponse(on.spine, off.spine, masks.spine), cover:lightResponse(on.cover, off.cover, masks.cover),
      drawCalls:Number(await scene.getAttribute('data-scene-draw-calls')),
      bounds:{ spine:await spine.boundingBox(), cover:await spine.locator('[data-shelf-cover-hit]').boundingBox() }
    };
    if (process.env.IHR_FINISH_REVIEW_DIR)
      await page.screenshot({ path:`${process.env.IHR_FINISH_REVIEW_DIR}/finish-${finish}.png` });
    await testInfo.attach(`libro-${finish}-luz-calida`, { body:await page.screenshot(), contentType:'image/png' });
    if (finish !== 'glossy') { await lamp.tap(); await expect(lamp).toHaveAttribute('data-lamp-power', '0.0000'); }
  }

  metrics.finishDifferences = {};
  for (const [a, b] of [['matte', 'satin'], ['satin', 'glossy'], ['matte', 'glossy']]) {
    metrics.finishDifferences[`${a}-${b}`] = {
      spine:difference(views[a].on.spine, views[b].on.spine, masks.spine),
      cover:difference(views[a].on.cover, views[b].on.cover, masks.cover)
    };
  }
  await testInfo.attach('acabados-y-reflejos-metricas', { body:JSON.stringify(metrics, null, 2), contentType:'application/json' });
  console.info('Book finish lighting metrics:', JSON.stringify(metrics));
  for (const pair of Object.values(metrics.finishDifferences)) {
    expect(pair.spine, 'El acabado del lomo debe cambiar el libro cerrado sin recargar').toBeGreaterThan(1);
    expect(pair.cover, 'Los tres acabados deben distinguirse en la portada real').toBeGreaterThan(1);
  }
  for (const finish of FINISHES) {
    expect(metrics.finishes[finish].cover.rgbDifference, `La luz debe afectar a la portada ${finish}`).toBeGreaterThan(2);
    // A glossy cover also reflects the daylight window: ambient compensation
    // can dim that broad neutral reflection when a lamp turns on. Test its
    // local warm highlight rather than requiring the whole jacket to tint.
    expect(metrics.finishes[finish].cover.warmHighlight95, `La lámpara debe producir un reflejo cálido visible en ${finish}`).toBeGreaterThan(5);
  }
  // A glossy coating must have a different light lobe, not merely a brighter
  // texture baked into the cover. Compare its actual on/off highlight tail.
  expect(Math.abs(metrics.finishes.glossy.cover.highlight95 - metrics.finishes.matte.cover.highlight95)).toBeGreaterThan(2);
  expect(new Set(FINISHES.map(finish => metrics.finishes[finish].drawCalls)).size).toBe(1);
  expect(metrics.finishes.glossy.drawCalls).toBeGreaterThan(0);

  await page.reload(); await expect(spine).toBeVisible(); await assertResting(scene);
  expect(await readBook(page)).toEqual({ cover:'glossy', spine:'glossy', edge:'glossy' });
  await spine.tap(); await page.getByRole('button', { name:'Editar', exact:true }).click();
  for (const label of FINISH_CONTROLS) await expect(page.getByLabel(label, { exact:true })).toHaveValue('glossy');
  expect(errors).toEqual([]);
});
