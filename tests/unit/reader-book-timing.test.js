import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readerBookTiming } from '../../src/js/reader-book-timing.js';

describe('responsive physical reader transitions', () => {
  it('keeps every physical phase while reducing the blocking opening time', () => {
    expect(readerBookTiming().opening).toEqual({ cover:480, bookmark:240, zoom:520, handoff:140 });
    expect(Object.values(readerBookTiming().opening).reduce((a,b) => a+b,0)).toBe(1380);
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
    expect(Object.values(readerBookTiming(true)).flatMap(Object.values)).toEqual(Array(8).fill(1));
  });
  it('uses the same schedule in the real model and fallback, with matching waits', () => {
    const source=readFileSync('src/js/bookshelf.js','utf8');
    const opening=source.slice(source.indexOf('async function finishReaderTransition'),source.indexOf('async function expandCover'));
    const closing=source.slice(source.indexOf('async function returnToShelf'),source.indexOf('async function returnToShelf')+22000);
    expect(opening).toContain('readerBookTiming(prefersReducedMotion()).opening');
    expect(opening).toContain('duration:durations.bookmark');
    expect(opening).toContain('waitForMotion(session.bookmarkMotion, durations.bookmark)');
    expect(opening).toContain('duration:durations.zoom');
    expect(closing).toContain('readerBookTiming(prefersReducedMotion()).closing');
    for (const phase of ['zoom','bookmark','cover']) {
      expect(closing).toContain(`duration:durations.${phase}`);
      expect(closing).toContain(`waitForMotion(animation, durations.${phase})`);
    }
    expect(closing).toContain('const duration = durations.flight');
  });
});
