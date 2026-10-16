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
    // The opening runs in the shelf module (rust-ui/src/bookshelf/flyout_motion.rs), the closing beside it (returning.rs).
    const rust=readFileSync('rust-ui/src/bookshelf/flyout_motion.rs','utf8');
    const opening=rust.slice(rust.indexOf('async fn transition_inner'));
    const returning=readFileSync('rust-ui/src/bookshelf/returning.rs','utf8');
    const closing=returning.slice(returning.indexOf('async fn return_to_shelf'));
    expect(rust).toContain('ctx.env("readerBookTiming",&[&b(prefers_reduced_motion())])');
    expect(rust).toContain('let durations=get(&timing,"opening")');
    expect(opening).toContain('let bookmark_duration=get(durations,"bookmark")');
    expect(opening).toContain('("duration",&bookmark_duration)');
    expect(opening).toContain('wait_for_motion(&motion,num(&bookmark_duration))');
    expect(opening).toContain('("duration",&get(durations,"zoom"))');
    expect(opening).toContain('wait_for_motion(&opening,num(&cover_duration))');
    expect(closing).toContain('ctx.env("readerBookTiming",&[&b(prefers_reduced_motion())])');
    expect(closing).toContain('let durations=get(&timing,"closing")');
    for (const phase of ['zoom','bookmark','cover']) {
      expect(closing).toContain(`let ${phase}=num(&get(&durations,"${phase}"))`);
      expect(closing).toContain(`wait_for_motion(&animation,${phase}).await?`);
    }
    expect(closing).toContain('let duration=num(&get(&durations,"flight"))');
  });
});
