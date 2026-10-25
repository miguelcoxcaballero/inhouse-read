import { describe, expect, it } from 'vitest'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { createSceneCountFrame } from '../../src/js/scene-count-frame.js'

describe('retained scene diagnostic counts', () => {
  it('skips unchanged input and invalidates equal-length resizes', () => {
    const native = new rustShelf.RustSceneCounts();
    try {
      native.resize(1);
      const values = () => new Float64Array(native.memory().buffer, native.input_ptr(), 5);
      values().set([0, 1, 0, 0, NaN]);
      expect(native.sample()).toBe(true);
      expect(native.sample()).toBe(false);
      values()[4] = 1024;
      expect(native.sample()).toBe(true);
      expect(native.resolutions()).toBe('[1024]');
      native.resize(1);
      expect(native.sample()).toBe(true);
    } finally { native.free(); }
  });

  it('matches the existing kernel across replacements, empty layouts and exceptional resolutions', () => {
    const frame = createSceneCountFrame(rustShelf), out = new Float64Array(8);
    try {
      for (let round = 0; round < 60; round++) {
        const entries = Array.from({ length: round % 13 }, (_, index) => ({
          kind: ['book', 'lamp', 'plant'][index % 3],
          qualityReplacement: round % 2 === 0,
          model: index % 4 ? { visible: round % 3 !== 0, userData: {
            overview: index % 2, inspectionResolution: [undefined, 0, -0, 1024, NaN, Infinity][(index + round) % 6]
          } } : null
        }));
        const packed = Float64Array.from(entries.flatMap(entry => [
          entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0,
          entry.model?.visible ? 1 : 0, entry.qualityReplacement ? 1 : 0,
          entry.model?.userData.overview ? 1 : 0, entry.model?.userData.inspectionResolution
        ]));
        const expected = new Float64Array(8), text = rustShelf.scene_counts(packed, expected);
        expect(frame.sample(entries, out)).toBe(text);
        expect(out).toEqual(expected);
        expect(frame.sample(entries, out)).toBe(text);
        expect(out).toEqual(expected);
      }
    } finally { frame.free(); }
    expect(() => frame.sample([], out)).toThrow(/disposed/);
    frame.free();
  });

  it('reacquires views after WebAssembly memory growth', () => {
    const native = new rustShelf.RustSceneCounts(), frame = createSceneCountFrame(rustShelf);
    try {
      frame.sample([], new Float64Array(8));
      native.memory().grow(1);
      expect(frame.sample([{ kind: 'plant', model: { visible: true, userData: {} } }], new Float64Array(8))).toBe('[]');
    } finally { frame.free(); native.free(); }
  });
});
