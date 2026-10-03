import { expect } from '@playwright/test';

/** Exercise the shipped finger gesture through trusted Chromium touch input.
 * No app API, storage mutation or hidden view controls are used. */
export async function switchShelfView(page, mode) {
  if (!['spine','isometric'].includes(mode)) throw new Error('Unknown shelf view');
  const root = page.locator('[data-ihr-bookshelf]');
  if (await root.getAttribute('data-view-mode') === mode) return;
  // An imported reader may have no flyout while its page is still closing.
  // That lifecycle disables pointer events on the shelf; wait before taking
  // its input coordinates. Camera transitions remain interruptible.
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader|is-reading/, { timeout:30_000 });
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 });
  const box = await root.locator('.ihr-bookshelf__scroll').boundingBox();
  if (!box || box.width < 120 || box.height < 70) throw new Error('Shelf must be visible before swiping');
  const y = box.y + Math.min(72, box.height * .2);
  const left = box.x + box.width * .22, right = box.x + box.width * .78;
  const start = mode === 'isometric' ? right : left, end = mode === 'isometric' ? left : right;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:start, y, id:0 }] });
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:start+(end-start)*step/6, y, id:0 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  } finally { await session.detach(); }
  await expect(root).toHaveAttribute('data-view-mode', mode);
}
