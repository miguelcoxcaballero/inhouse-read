import { describe, it, expect } from 'vitest';
import { CATALOG_CAMERA_MS, bookletRect, catalogCameraFrames } from '../../src/js/catalog-camera.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });

describe('catalog camera', () => {
  it('lasts between 400 and 550 ms', () => {
    expect(CATALOG_CAMERA_MS).toBeGreaterThanOrEqual(400);
    expect(CATALOG_CAMERA_MS).toBeLessThanOrEqual(550);
  });

  it('puts the booklet cover over the centre of the page, filling it', () => {
    const booklet = rect(100, 200, 40, 60), page = rect(8, 20, 374, 800), stage = rect(0, 0, 390, 844);
    const { stage:transform } = catalogCameraFrames(booklet, page, stage);
    const [, tx, ty, scale] = transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)/).map(Number);
    expect(scale).toBeCloseTo(Math.max(374 / 40, 800 / 60), 3);
    expect(tx + scale * 120).toBeCloseTo(8 + 187, 1);
    expect(ty + scale * 230).toBeCloseTo(20 + 400, 1);
  });

  it('unfolds the page from the cover rectangle', () => {
    const { page } = catalogCameraFrames(rect(100, 200, 40, 60), rect(8, 20, 374, 800), rect(0, 0, 390, 844));
    expect(page).toBe('translate(92px, 180px) scale(0.107, 0.075)');
  });

  it('gives up on empty rectangles', () => {
    expect(catalogCameraFrames(rect(0, 0, 0, 10), rect(0, 0, 10, 10), rect(0, 0, 10, 10))).toBeNull();
  });

  it('reads the printed cover inside the button, or falls back to the button', () => {
    const node = { dataset:{ bookletFace:'4 6 30.5 40' }, getBoundingClientRect:() => rect(50, 60, 40, 50) };
    expect(bookletRect(node)).toMatchObject({ left:54, top:66, width:30.5, height:40 });
    expect(bookletRect({ dataset:{}, getBoundingClientRect:() => rect(50, 60, 40, 50) })).toMatchObject({ left:50, width:40 });
  });
});
