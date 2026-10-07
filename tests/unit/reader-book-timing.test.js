import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cubicBezier, openingDuration, OPENING_EASING, readerBookTiming } from '../../src/js/reader-book-timing.js';

describe('responsive physical reader transitions', () => {
  it('keeps every physical phase, overlapped into one opening shorter than the 1.7.97 sequence', () => {
    const opening = readerBookTiming().opening;
    expect(opening).toEqual({ cover:520, bookmark:280, zoom:580, handoff:120, bookmarkAt:250, zoomAt:450 });
    // The ribbon leaves while the board lands; the camera leans in as the spread settles.
    expect(opening.bookmarkAt).toBeLessThan(opening.cover);
    expect(opening.zoomAt).toBeGreaterThan(opening.bookmarkAt);
    expect(opening.zoomAt).toBeLessThan(Math.min(opening.cover, opening.bookmarkAt + opening.bookmark));
    expect(openingDuration(opening)).toBe(1150);
    expect(openingDuration(opening)).toBeLessThan(1380);
  });
  it('eases every opening layer from rest to rest, monotonically', () => {
    for (const points of Object.values(OPENING_EASING)) {
      const ease = cubicBezier(points);
      expect(ease(0)).toBe(0); expect(ease(1)).toBe(1);
      let previous = 0;
      for (let i = 1; i <= 100; i++) { const value = ease(i / 100); expect(value).toBeGreaterThanOrEqual(previous - 1e-9); previous = value; }
      expect(ease(.01)).toBeLessThan(.01); expect(1 - ease(.99)).toBeLessThan(.01);
    }
  });
  it('keeps the same landing flight and shortens the three reader closing phases', () => {
    expect(readerBookTiming().closing).toEqual({ zoom:460, bookmark:260, cover:440, flight:560 });
    expect(Object.values(readerBookTiming().closing).reduce((a,b) => a+b,0)).toBe(1720);
  });
  it('honours reduced motion and makes both schedules immutable', () => {
    for (const settings of [readerBookTiming(), readerBookTiming(true)]) {
      expect(Object.isFrozen(settings)).toBe(true);
      for (const phase of Object.values(settings)) expect(Object.isFrozen(phase)).toBe(true);
    }
    const { opening, closing } = readerBookTiming(true);
    expect(Object.values(closing)).toEqual(Array(4).fill(1));
    expect(opening).toEqual({ cover:1, bookmark:1, zoom:1, handoff:1, bookmarkAt:0, zoomAt:0 });
  });
  it('uses the same schedule in the real model and fallback, with matching waits', () => {
    const source=readFileSync('src/js/bookshelf.js','utf8');
    const opening=source.slice(source.indexOf('function fallbackPageZoom'),source.indexOf('async function expandCover'));
    const closing=source.slice(source.indexOf('async function returnToShelf'),source.indexOf('async function returnToShelf')+22000);
    expect(opening).toContain('readerBookTiming(prefersReducedMotion()).opening');
    // The WebGL motion and the CSS fallback run the same overlapped schedule.
    expect(opening).toContain('cover:durations.cover, bookmark:durations.bookmark');
    expect(opening).toContain('bookmarkAt:durations.bookmarkAt');
    expect(opening).toContain("{ duration:durations.cover, easing:cssEasing(OPENING_EASING.hinge), fill:'both' }");
    expect(opening).toContain('motion.when(durations.bookmarkAt)');
    expect(opening).toContain('{ at:timing.zoomAt, duration:target.duration }');
    expect(opening).toContain('duration:durations.zoom');
    expect(opening).toContain('duration:fadeDuration');
    expect(closing).toContain('readerBookTiming(prefersReducedMotion()).closing');
    for (const phase of ['zoom','bookmark','cover']) {
      expect(closing).toContain(`duration:durations.${phase}`);
      expect(closing).toContain(`waitForMotion(animation, durations.${phase})`);
    }
    expect(closing).toContain('const duration = durations.flight');
  });
});
