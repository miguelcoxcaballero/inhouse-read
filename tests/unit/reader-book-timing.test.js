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
    // The opening runs in the shelf module (rust-ui/src/bookshelf/flyout_motion.rs); the closing is still in bookshelf.js.
    const rust=readFileSync('rust-ui/src/bookshelf/flyout_motion.rs','utf8');
    const opening=rust.slice(rust.indexOf('async fn transition_inner'));
    const source=readFileSync('src/js/bookshelf.js','utf8');
    const closing=source.slice(source.indexOf('async function returnToShelf'),source.indexOf('async function returnToShelf')+22000);
    expect(rust).toContain('ctx.env("readerBookTiming",&[&b(prefers_reduced_motion())])');
    expect(rust).toContain('let durations=get(&timing,"opening")');
    expect(opening).toContain('let bookmark_duration=get(durations,"bookmark")');
    expect(opening).toContain('("duration",&bookmark_duration)');
    expect(opening).toContain('wait_for_motion(&motion,num(&bookmark_duration))');
    expect(opening).toContain('("duration",&get(durations,"zoom"))');
    expect(opening).toContain('wait_for_motion(&opening,num(&cover_duration))');
    expect(closing).toContain('readerBookTiming(prefersReducedMotion()).closing');
    for (const phase of ['zoom','bookmark','cover']) {
      expect(closing).toContain(`duration:durations.${phase}`);
      expect(closing).toContain(`waitForMotion(animation, durations.${phase})`);
    }
    expect(closing).toContain('const duration = durations.flight');
  });
});
