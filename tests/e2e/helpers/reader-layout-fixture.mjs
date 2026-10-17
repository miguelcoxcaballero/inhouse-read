import {expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {settledGeometryLength} from './settled-geometry-length.mjs';
const BOOK_PREFIX='motion:book:',LAMP_KEY='inhouse-read-shelf-lamps',PLANT_KEY='inhouse-read-shelf-plants';
const TARGET_URL=process.env.IHR_TEST_URL||'/';
export async function quietShelf(scene) {
  await scene.page().evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  await expect(scene).toHaveAttribute('data-inspection-moving', 'false', { timeout:30_000 });
  await expect(scene).toHaveAttribute('data-book-quality-pending', '0', { timeout:30_000 });
  await expect.poll(async () => {
    const before = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(400);
    const middle = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(400);
    return before === middle && middle === await scene.getAttribute('data-snapshot-render-count');
  }, { timeout:30_000 }).toBe(true);
}

export async function seedShelf(page, {domino=false,single=false,mode='isometric'}={}) {
  await page.addInitScript(({ lampKey, plantKey, domino, single, mode }) => {
    localStorage.setItem('inhouse-read-shelf-view', mode);
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem(plantKey, JSON.stringify(single ? [] : [
      { key:'plant:motion', seed:'motion', catalogId:'sansevieria', variant:'sansevieria',
        potId:'muskot', width:42, height:124, shelf:domino?2:0, x:.76 }
    ]));
    localStorage.setItem(lampKey, JSON.stringify(single ? [] : [
      { key:'lamp:motion', lampId:'tarnaby', shelf:1, x:.56, isOn:true }
    ]));
  }, { lampKey:LAMP_KEY, plantKey:PLANT_KEY, domino, single, mode });
  await page.goto(TARGET_URL);
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix, geometry, domino, single }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const covers = [];
    for (let index = 0; index < 6; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1200;
      const context = canvas.getContext('2d');
      context.fillStyle = ['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)];
      context.fillRect(0, 0, 800, 1200); context.fillStyle = '#e8e2cf';
      context.font = '32px serif'; context.fillText(`LIBRO ${index + 1}`, 56, 112);
      covers.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    }
    const transaction = db.transaction('books', 'readwrite'), books = transaction.objectStore('books');
    for (let index = 0; index < (single ? 1 : 6); index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`motion-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:260,
      ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:covers[index],
      coverFinish:index % 2 ? 'satin' : 'glossy', spineSurfaceFinish:index % 2 ? 'satin' : 'glossy',
      spineColorOverride:['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)],
      shelfPosition:single ? {shelf:1,x:.5} : domino ? {shelf:index<5?0:2,x:index<5?.15+index*.04:.2} : { shelf:Math.floor(index / 2), x:index % 2 ? .38 : .19 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); db.close();
  }, { bytes, prefix:BOOK_PREFIX, geometry:await settledGeometryLength(78_000, 'shelf-motion'), domino, single });
  await page.reload();
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(page.locator('.ihr-spine')).toHaveCount(single ? 1 : 6);
  await expect(page.locator('.ihr-plant')).toHaveCount(single ? 0 : 1);
  await expect(page.locator('.ihr-lamp')).toHaveCount(single ? 0 : 1);
  await expect(scene).toHaveAttribute('data-shelf-type', 'baggebo');
  await expect(scene).toHaveAttribute('data-view-progress', mode === 'isometric' ? '1' : '0');
  await quietShelf(scene);
  return scene;
}

export async function visibleMiddleBookPoint(page, fractions=[.5,.65,.35], row=1) {
  return page.evaluate(({fractions,row}) => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect();
    for (const node of document.querySelectorAll(`.ihr-spine[data-shelf-index="${row}"]`)) {
      // The book's binding target is its native padded tap rectangle. A
      // tilted cover's envelope also contains empty space; prefer the binding
      // before considering the broader cover envelope.
      const rectangles=[node.getBoundingClientRect(),node.querySelector('[data-shelf-cover-hit]')?.getBoundingClientRect()].filter(Boolean);
      for(const rect of rectangles){
      const left = Math.max(rect.left, scroller.left, 8), right = Math.min(rect.right, scroller.right, innerWidth - 8);
      const top = Math.max(rect.top, scroller.top + 8), bottom = Math.min(rect.bottom, scroller.bottom - 8, innerHeight - 8);
      if (right - left <= 12 || bottom - top <= 20) continue;
      // Check a painted book's native target, rather than an empty corner of
      // a projected rectangle or a neighbouring lamp in front of the cover.
      for (const fraction of fractions) {
        const x = left + (right - left) * fraction, y = (top + bottom) / 2;
        if (document.elementFromPoint(x, y)?.closest('.ihr-spine') === node)
          return { x, y, id:node.dataset.bookId };
      }
      }
    }
    return null;
  }, {fractions,row});
}

