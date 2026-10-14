// Differential test: the frame padding decision of the Rust core
// (rust-core/src/frame_padding.rs behind book-frame-padding.js) against the frozen original.
import { describe, expect, it } from 'vitest';
import { core } from '../../src/js/catalogue-core.js';
import * as rust from '../../src/js/book-frame-padding.js';
import * as original from './helpers/reference-book-frame-padding.js';

const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rng = seeded(99);
const pick = list => list[Math.floor(rng() * list.length)];
const dimension = () => pick([1, 2, 100, 360, 384, 385, 390, 844, 1000, 1.5, 0, -3, NaN, Infinity, '12', undefined, null, 4e9, rng() * 900, Math.floor(rng() * 900) + 1]);

describe('book frame padding', () => {
  it('equals the original for 200000 random frames, neighbours and scales', () => {
    for (let n = 0; n < 200000; n++) {
      const width = dimension(), height = dimension();
      const frame = rng() < .02 ? pick([{}, { width }, { height }]) : { width, height };
      // Most cases are a plausible one-axis shrink so every branch is reached.
      const near = rng() < .7 && Number.isInteger(width) && Number.isInteger(height);
      const previous = near ? { x: width + pick([0, 1, 5, 16, 17, -1, 100]), y: height + pick([0, 0, 0, 1, 64, 128, 129, -5, 384 - height]) }
        : rng() < .05 ? pick([undefined, null, {}, { x: 5 }]) : { x: dimension(), y: dimension() };
      const ratio = pick([1, 2, 3, 3.5, 0, -1, '2', NaN, undefined, 2, 2, 1]);
      const physical = rng() < .6 && previous && Number.isFinite(previous.x * previous.y)
        ? { width: previous.x * ratio + pick([0, 0, 0, 1, -1]), height: previous.y * ratio + pick([0, 0, 0, 1]) }
        : pick([undefined, null, {}, { width: dimension(), height: dimension() }]);
      const allowed = pick([true, true, true, false, 0, 1, undefined, null, 'yes', '']);
      expect(rust.paddedBookFrameWidth(frame, previous, ratio, physical, allowed)).toBe(original.paddedBookFrameWidth(frame, previous, ratio, physical, allowed));
      expect(rust.paddedBookFrameSize(frame, previous, ratio, physical, allowed)).toStrictEqual(original.paddedBookFrameSize(frame, previous, ratio, physical, allowed));
    }
  }, 120000);

  it('throws exactly where the original throws and returns the same references', () => {
    for (const bad of [undefined, null]) {
      expect(() => rust.paddedBookFrameWidth(bad, undefined, 1, undefined, true)).toThrow(TypeError);
      expect(() => original.paddedBookFrameWidth(bad, undefined, 1, undefined, true)).toThrow(TypeError);
      expect(() => rust.paddedBookFrameSize(bad, undefined, 1, undefined, true)).toThrow(TypeError);
    }
    expect(rust.paddedBookFrameWidth({ width: 1.5, height: 2 }, undefined, 1, undefined, true)).toBe(1.5);
    expect(rust.paddedBookFrameWidth({ width: 100, height: 50 }, { x: 110, y: 50 }, 2, { width: 220, height: 100 }, true)).toBe(110);
    expect(rust.paddedBookFrameSize({ width: 100, height: 50 }, { x: 110, y: 60 }, 2, { width: 220, height: 120 }, true)).toStrictEqual({ width: 110, height: 60 });
  });

  it('rejects unusable pointers and leaves memory alone', () => {
    expect(core.padded_frame_size(1, 10, 10, 12, 10, 1, 12, 10, 0)).toBe(0);
    expect(core.padded_frame_size(1, 10, 10, 12, 10, 1, 12, 10, 1)).toBe(0);
    const size = core.memory.buffer.byteLength;
    for (let n = 0; n < 50000; n++) rust.paddedBookFrameSize({ width: 100, height: 50 }, { x: 110, y: 60 }, 2, { width: 220, height: 120 }, true);
    expect(core.memory.buffer.byteLength).toBe(size);
  });
});
