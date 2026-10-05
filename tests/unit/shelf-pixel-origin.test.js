import { describe, expect, it } from 'vitest';
import { shelfPixelOffset } from '../../src/js/shelf-pixel-origin.js';

describe('shelf origin and physical pixels', () => {
  it('aligns the hidden-heading mobile origin without resizing its framebuffer', () => {
    expect(shelfPixelOffset(61,390,784,1.5)).toBe(1);
    expect((61+shelfPixelOffset(61,390,784,1.5))*1.5).toBe(93);
  });
  it('retains the original already-aligned room and every scroll position', () => {
    expect(shelfPixelOffset(132,390,784,1.5)).toBe(0);
    for(let scroll=0;scroll<100;scroll++) expect(shelfPixelOffset((62-scroll)+scroll-1,390,784,1.5)).toBe(1);
  });
  it('keeps fractional 393px framebuffer geometry on its original path', () => {
    expect(shelfPixelOffset(61,393,784,1.5)).toBe(0);
    expect(shelfPixelOffset(61,390,783,1.5)).toBe(0);
  });
  it('does not shift ordinary desktop or integer-DPR positions', () => {
    expect(shelfPixelOffset(61,1000,784,2)).toBe(0);
    expect(shelfPixelOffset(61,390,784,1)).toBe(0);
  });
  it('chooses the nearest representable origin for other pixel ratios', () => {
    expect(shelfPixelOffset(61.25,400,800,2)).toBe(-.25);
    expect(shelfPixelOffset(61,400,800,1.25)).toBe(-1);
  });
  it.each([NaN,Infinity,-Infinity])('leaves invalid coordinate %s unchanged', top => {
    expect(shelfPixelOffset(top,390,784,1.5)).toBe(0);
  });
  it('leaves invalid ratios unchanged', () => {
    expect(shelfPixelOffset(61,390,784,0)).toBe(0);
    expect(shelfPixelOffset(61,390,784,NaN)).toBe(0);
  });
});
