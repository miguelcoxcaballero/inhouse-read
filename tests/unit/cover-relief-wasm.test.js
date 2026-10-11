// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadRustCore, getRustCore } from '../../src/js/rust-core.js';
import { composeMaterialMap, composeReliefLayerPixels, heightToNormals, internals } from '../../src/js/cover-relief.js';
import { canUseReliefWasm, wasmInsideDistance, wasmBoxBlur, wasmHeightToNormals,
  wasmComposeMaterialMap, wasmComposeReliefLayers } from '../../src/js/cover-relief-wasm.js';
import { referenceDistance, referenceBlur, referenceNormals, referenceMaterial, referenceCompose,
  materialCoefficients, layers, mapsFor } from '../helpers/cover-relief-reference.mjs';

// Independent pre-port algorithms, frozen from 7eb558a. These deliberately
// retain JS Number arithmetic, typed-array writes and browser Math.hypot; they
// neither call the new kernels nor derive expected values from WASM output.
const drain = task => { let step; do { step = task.next(); } while (!step.done); return step.value; };
// Buffer comparison is byte exact, including each f32 store, without asking
// the assertion library to recursively visit a million pixel properties.
const expectBytes = (actual, expected) => {
  expect(actual).toBeInstanceOf(expected.constructor);
  expect(actual.length).toBe(expected.length);
  const a = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
  const b = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
  expect(a.compare(b), 'the complete numeric buffer must be byte-identical').toBe(0);
};

let core;
beforeAll(async () => {
  const bytes = new Uint8Array(await readFile(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)));
  core = await loadRustCore({ bytes });
  expect(core).not.toBeNull();
  expect(getRustCore()).toBe(core);
  for (const name of ['relief_distance_init', 'relief_distance_rows', 'relief_blur_pass', 'relief_normal_rows',
    'relief_material_pixels', 'relief_compose_pixels']) expect(typeof core[name]).toBe('function');
});

describe('actual Rust cover-map kernels against frozen JavaScript', () => {
  for (const [width, height] of [[1, 1], [1, 33], [47, 1], [15, 17], [32, 48], [73, 91], [288, 192], [512, 511]]) {
    it(`keeps chamfer distance f32 bytes exact at ${width}×${height}`, () => {
      const count = width * height;
      for (const pattern of [() => 0, () => 1, i => (i * 31 + Math.floor(i / width) * 17) % 41 > 9]) {
        const mask = Uint8Array.from({ length:count }, pattern), original = mask.slice();
        const expected = referenceDistance(mask, width, height);
        expectBytes(drain(wasmInsideDistance(core, mask, width, height)), expected);
        expectBytes(drain(internals.insideDistance(mask, width, height)), expected);
        expectBytes(mask, original);
      }
    });
  }

  for (const [width, height] of [[1, 1], [1, 35], [47, 1], [17, 31], [192, 288]]) {
    it(`keeps both f32 blur passes exact at ${width}×${height}`, () => {
      const field = Float32Array.from({ length:width * height }, (_, i) => ((i * 433 % 8191) - 3000) / 13);
      const original = field.slice();
      for (const radius of [1, 2, 7, 19]) {
        const expected = referenceBlur(field, width, height, radius);
        expectBytes(drain(wasmBoxBlur(core, field, width, height, radius)), expected);
        expectBytes(drain(internals.boxBlur(field, width, height, radius)), expected);
      }
      expectBytes(field, original);
      expect(drain(internals.boxBlur(field, width, height, 0))).toBe(field);
    });
  }

  for (const [width, height] of [[1, 1], [1, 35], [47, 1], [17, 31], [128, 193], [512, 512]]) {
    it(`preserves normal RGBA bytes, pigment boundaries and gain at ${width}×${height}`, () => {
      for (const withOwners of [false, true]) {
        const maps = mapsFor(width, height, 19, withOwners), original = maps.heightMap.slice();
        for (const gain of [0, .03, 1, 3.7, 1000]) {
          const unit = .6 / 255 / (2 * (200 / Math.max(width, height))) * gain;
          const expected = referenceNormals(maps, gain);
          expectBytes(drain(wasmHeightToNormals(core, maps, unit)), expected);
          expectBytes(drain(heightToNormals(maps, { gain })), expected);
        }
        expectBytes(maps.heightMap, original);
      }
    });
  }

  it('preserves all material channels and independent finishes for ten pigments', () => {
    for (const withOwners of [false, true]) for (const seed of [0, 1, 191, 254]) {
      const maps = mapsFor(73, 91, seed, withOwners);
      for (const options of [{}, { clearcoat:.35, roughness:.48, clearcoatRoughness:.28 },
        { clearcoat:1, roughness:0, clearcoatRoughness:0 }, { clearcoat:.5, roughness:1, clearcoatRoughness:1 }]) {
        const expected = referenceMaterial(maps, options);
        expectBytes(drain(wasmComposeMaterialMap(core, maps, materialCoefficients(maps, options))), expected);
        expectBytes(drain(composeMaterialMap(maps, options)), expected);
      }
    }
  });

  it('uses Uint8Clamped ties-to-even rather than truncation or Math.round', () => {
    const maps = mapsFor(1, 1, 0, false); maps.gloss[0] = maps.foil[0] = 0;
    for (const value of [0.5, 1.5, 2.5, 3.5, 126.5, 127.5, 128.5, 253.5, 254.5]) {
      const options = { clearcoat:value / 255 };
      const result = drain(wasmComposeMaterialMap(core, maps, materialCoefficients(maps, options)));
      expectBytes(result, referenceMaterial(maps, options));
      expect(result[0]).toBe(new Uint8ClampedArray([value])[0]);
    }
  });

  it('keeps ten-layer slider recomposition identical without modifying source planes', () => {
    const maps = mapsFor(193, 128), originals = [maps.owners.slice(), maps.baseMask.slice(), maps.baseHeight.slice()];
    for (const strength of [0, .01, .25, .5, .75, 1]) {
      const selected = layers.map((layer, index) => ({ ...layer, strength:index % 2 ? strength : 1 - strength }));
      const expected = referenceCompose(maps, selected);
      for (const result of [drain(wasmComposeReliefLayers(core, maps, selected)),
        drain(composeReliefLayerPixels(maps, { layers:selected }))]) {
        for (const plane of ['heightMap', 'mask', 'gloss', 'foil']) expectBytes(result[plane], expected[plane]);
        expect(result.layers).toEqual(selected);
        expect(result.heightMap).not.toBe(maps.heightMap);
      }
    }
    [maps.owners, maps.baseMask, maps.baseHeight].forEach((plane, index) => expectBytes(plane, originals[index]));
  });

  it('recreates views after another WASM task grows memory between safe points', () => {
    const maps = mapsFor(64, 65), task = wasmHeightToNormals(core, maps, .6 / 255 / (2 * (200 / 65)));
    expect(task.next().done).toBe(false);
    core.memory.grow(1);
    expectBytes(drain(task), referenceNormals(maps));
  });

  it('releases arenas when any numeric generator is cancelled between chunks', () => {
    const maps = mapsFor(128, 129), unit = .6 / 255 / (2 * (200 / 129));
    for (const factory of [
      tracked => wasmInsideDistance(tracked, maps.mask, maps.width, maps.height),
      tracked => wasmBoxBlur(tracked, maps.baseHeight, maps.width, maps.height, 2),
      tracked => wasmHeightToNormals(tracked, maps, unit),
      tracked => wasmComposeMaterialMap(tracked, maps, materialCoefficients(maps)),
      tracked => wasmComposeReliefLayers(tracked, maps, layers)
    ]) {
      const tracked = { ...core, alloc_f64:vi.fn(core.alloc_f64), free_f64:vi.fn(core.free_f64) };
      const task = factory(tracked);
      expect(task.next().done).toBe(false);
      expect(tracked.alloc_f64).toHaveBeenCalledTimes(1);
      expect(tracked.free_f64).not.toHaveBeenCalled();
      task.return();
      expect(tracked.free_f64).toHaveBeenCalledTimes(1);
      expect(tracked.free_f64.mock.calls[0]).toEqual([tracked.alloc_f64.mock.results[0].value, tracked.alloc_f64.mock.calls[0][0]]);
    }
  });

  it('rejects unsupported shapes before allocating and frees rejected passes', () => {
    expect(canUseReliefWasm(null, 32, 32)).toBe(false);
    const tracked = { ...core, alloc_f64:vi.fn(core.alloc_f64), free_f64:vi.fn(core.free_f64) };
    expect(drain(wasmInsideDistance(tracked, new Uint8Array(3), 2, 2))).toBeNull();
    expect(drain(wasmBoxBlur(tracked, new Float32Array(4), 2, 2, 1.5))).toBeNull();
    expect(tracked.alloc_f64).not.toHaveBeenCalled();
    const broken = { ...tracked, relief_distance_rows:() => 0 };
    expect(() => drain(wasmInsideDistance(broken, new Uint8Array(4), 2, 2))).toThrow('rechazó');
    expect(tracked.free_f64).toHaveBeenCalledTimes(1);
  });
});
