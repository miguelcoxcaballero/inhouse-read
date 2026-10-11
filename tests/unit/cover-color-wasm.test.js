// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustDominantCoverRgb } from '../../src/js/cover-color-wasm.js';
import { referenceDominantRgb } from './helpers/reference-cover-color.js';
import { coverColorCases, createCoverColorPixels } from '../helpers/cover-color-cases.mjs';

let core;
beforeAll(async () => {
  core = await loadRustCore({ bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
  expect(typeof core?.cover_dominant_rgb).toBe('function');
});
function compare(data, width, height) {
  const result = rustDominantCoverRgb(core, data, width, height);
  expect(result).not.toBeNull(); expect(result).toEqual(referenceDominantRgb(data, width, height));
  return result;
}
const pixels = colors => Uint8ClampedArray.from(colors.flatMap(color => color.length === 4 ? color : [...color, 255]));

describe('actual compiled Rust cover clustering retains every legacy color decision', () => {
  it('keeps empty sampled alpha in the allocation-free original shortcut', () => {
    const transparent = createCoverColorPixels({ width:192, height:288, kind:'alpha' });
    let allocations = 0, calls = 0;
    const tracked = { ...core,
      alloc_f64(...args) { allocations++; return core.alloc_f64(...args); },
      cover_dominant_rgb(...args) { calls++; return core.cover_dominant_rgb(...args); }
    };
    expect(rustDominantCoverRgb(tracked, transparent, 192, 288)).toEqual([90, 65, 48]);
    expect(allocations).toBe(0); expect(calls).toBe(0);
    expect(referenceDominantRgb(transparent, 192, 288)).toEqual([90, 65, 48]);
  });
  for (const input of coverColorCases) it(`matches ${input.name} exactly`, () => {
    compare(createCoverColorPixels(input), input.width, input.height);
  });
  it('retains the threshold at alpha48 without alpha weighting', () => {
    expect(compare(pixels([[255, 0, 0, 47], [0, 255, 0, 48]]), 2, 1)).toEqual([0, 255, 0]);
    expect(compare(pixels([[255, 0, 0, 48], [255, 0, 0, 48], [0, 0, 255, 255]]), 3, 1)).toEqual([255, 0, 0]);
    expect(compare(pixels([[255, 0, 0, 0], [0, 0, 255, 47]]), 2, 1)).toEqual([90, 65, 48]);
  });
  it('keeps first-sample and first-center ties and duplicated empty centers', () => {
    for (const colors of [
      [[123, 87, 65]], [[123, 87, 65], [123, 87, 65]],
      [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
      [[0, 0, 255], [255, 0, 0], [0, 255, 0]],
      [[0, 0, 0], [2, 0, 0], [1, 0, 0], [1, 0, 0], [0, 2, 0]],
      [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255]],
    ]) compare(pixels(colors), colors.length, 1);
    expect(compare(pixels([[255, 0, 0], [0, 255, 0], [0, 0, 255]]), 3, 1)).toEqual([255, 0, 0]);
    expect(compare(pixels([[0, 0, 255], [255, 0, 0], [0, 255, 0]]), 3, 1)).toEqual([0, 0, 255]);
  });
  it('rounds half-valued final cluster means with browser Math.round', () => {
    expect(compare(pixels([[0, 0, 0], [1, 1, 1], [255, 0, 0], [0, 255, 0]]), 4, 1)).toEqual([1, 1, 1]);
  });
  it('copies exactly the original row-major sample locations without reading unsampled colors', () => {
    const width = 72, height = 100, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set([x, y, (x + y) & 255, (x % 2 || y % 2) ? 255 : 47], offset);
    }
    const expected = [];
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) expected.push(...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
    let actual;
    const wrapped = { ...core, cover_dominant_rgb(pointer, count, output) {
      actual = new Uint8Array(new Uint8Array(core.memory.buffer, pointer, count * 4));
      core.cover_dominant_rgb(pointer, count, output);
    } };
    expect(rustDominantCoverRgb(wrapped, data, width, height)).toEqual([90, 65, 48]);
    expect(actual).toBeUndefined(); // Opaque unsampled pixels cannot defeat the empty shortcut.
    data[(98 * width + 70) * 4 + 3] = 48;
    expected[expected.length - 1] = 48;
    expect(rustDominantCoverRgb(wrapped, data, width, height)).toEqual([70, 98, 168]);
    expect(Array.from(actual)).toEqual(expected);
  });
  it('matches seeded mixed-alpha covers across stride transitions and asymmetric dimensions', () => {
    const dimensions = [[1, 1], [1, 7201], [7201, 1], [41, 43], [42, 43], [71, 101], [72, 100], [191, 287], [192, 288], [319, 457]];
    for (let seed = 1; seed <= 12; seed++) for (const [width, height] of dimensions) {
      compare(createCoverColorPixels({ width, height, kind:seed % 2 ? 'alpha' : 'noise' }, seed), width, height);
    }
  });
  it('keeps source subarray offsets, leaves source bytes unchanged and returns independent outputs', () => {
    const input = coverColorCases[2], source = createCoverColorPixels(input);
    const backing = new Uint8Array(source.length + 37); backing.set(source, 13);
    const view = backing.subarray(13, 13 + source.length), before = Buffer.from(view);
    const result = compare(view, input.width, input.height), snapshot = [...result];
    compare(createCoverColorPixels(coverColorCases[3]), 192, 288); core.memory.grow(1);
    expect(result).toEqual(snapshot); expect(Buffer.from(view)).toEqual(before);
  });
  it('releases every bounded arena and reacquires views when the kernel grows memory', () => {
    const allocations = [], releases = [], input = coverColorCases[1], data = createCoverColorPixels(input);
    const wrapped = { ...core,
      alloc_f64(length) { const pointer = core.alloc_f64(length); allocations.push([pointer, length]); return pointer; },
      free_f64(pointer, length) { releases.push([pointer, length]); core.free_f64(pointer, length); },
      cover_dominant_rgb(...args) { core.memory.grow(1); core.cover_dominant_rgb(...args); },
    };
    expect(rustDominantCoverRgb(wrapped, data, input.width, input.height)).toEqual(referenceDominantRgb(data, input.width, input.height));
    expect(allocations).toHaveLength(1); expect(releases).toEqual(allocations);
    expect(allocations[0][1] * 8).toBe(Math.ceil(39 * 58 * 4 / 8) * 8 + 24);
  });
  it('falls back without an allocation for unavailable kernels or unsupported pixel contracts', () => {
    const data = pixels([[20, 30, 40]]);
    expect(rustDominantCoverRgb(null, data, 1, 1)).toBeNull();
    expect(rustDominantCoverRgb({ ...core, cover_dominant_rgb:null }, data, 1, 1)).toBeNull();
    let allocated = false;
    const wrapped = { ...core, alloc_f64() { allocated = true; throw new Error('unreachable'); } };
    for (const [image, width, height] of [[data, 0, 1], [data, 1, NaN], [data, 1.5, 1],
      [data, 1, 2], [Array.from(data), 1, 1], [new Float32Array(4), 1, 1], [data, 1e20, 1]]) {
      expect(rustDominantCoverRgb(wrapped, image, width, height)).toBeNull();
    }
    // Degenerate huge strips are outside the bounded acceleration path.
    expect(rustDominantCoverRgb(wrapped, new Uint8Array(700000 * 4), 1, 700000)).toBeNull();
    expect(allocated).toBe(false);
  });
  it('uses the original path on allocation/kernel failures and still releases successful allocations', () => {
    const data = pixels([[20, 30, 40]]);
    expect(rustDominantCoverRgb({ ...core, alloc_f64:() => 0 }, data, 1, 1)).toBeNull();
    expect(rustDominantCoverRgb({ ...core, alloc_f64() { throw new RangeError('exhausted'); } }, data, 1, 1)).toBeNull();
    const allocations = [], releases = [];
    const wrapped = { ...core,
      alloc_f64(length) { const pointer = core.alloc_f64(length); allocations.push([pointer, length]); return pointer; },
      free_f64(pointer, length) { releases.push([pointer, length]); core.free_f64(pointer, length); },
      cover_dominant_rgb() { throw new WebAssembly.RuntimeError('trap'); },
    };
    expect(rustDominantCoverRgb(wrapped, data, 1, 1)).toBeNull();
    expect(releases).toEqual(allocations); expect(allocations).toHaveLength(1);
  });
});
