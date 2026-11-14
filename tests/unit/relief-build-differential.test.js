// @vitest-environment node
// buildMapsFromPixels is one job of the shelf module (ReliefJob.build, rust-ui/src/relief_job.rs) that runs the
// palette, classification and composition jobs one after the other. This is the guard that let the JavaScript
// generators go: production is compared with their frozen copy (helpers/reference-cover-relief-flow.js) byte for
// byte, key for key (in order), pause for pause, error for error and job for job.
import { afterEach, describe, expect, it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import * as production from '../../src/js/cover-relief.js';
import * as frozen from './helpers/reference-cover-relief-flow.js';
import { makeColorMaskImage, colorMaskCases, colorMaskSelection } from '../helpers/color-mask-cases.mjs';

const shelf = needRustShelf();
afterEach(() => { expect(shelf.relief_jobs_live(), 'every job is freed').toBe(0); });

const drain = task => { let yields = 0; for (;;) { const step = task.next(); if (step.done) return { value: step.value, yields }; yields++; } };
const raw = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function exact(actual, expected, label = 'value') {
  if (ArrayBuffer.isView(expected)) {
    expect(actual?.constructor, label).toBe(expected.constructor);
    expect(actual.length, label).toBe(expected.length);
    expect(Buffer.compare(raw(actual), raw(expected)), `${label} bytes`).toBe(0);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), label).toBe(true);
    expect(actual.length, label).toBe(expected.length);
    expected.forEach((item, index) => exact(actual[index], item, `${label}[${index}]`));
  } else if (expected && typeof expected === 'object') {
    expect(Object.keys(actual), label).toEqual(Object.keys(expected));
    for (const key of Object.keys(expected)) exact(actual[key], expected[key], `${label}.${key}`);
  } else expect(Object.is(actual, expected), `${label}: ${actual} vs ${expected}`).toBe(true);
}
/** Both implementations on the same inputs: value, pauses, jobs made, or the same error. */
function both(work, hires, selection, label) {
  const outcome = module => {
    const made = shelf.relief_jobs_made();
    try { const out = drain(module.buildMapsFromPixels(work, hires, selection)); return { ...out, jobs: shelf.relief_jobs_made() - made }; }
    catch (error) { return { error, jobs: shelf.relief_jobs_made() - made }; }
  };
  const expected = outcome(frozen), actual = outcome(production);
  expect(actual.jobs, `${label} jobs`).toBe(expected.jobs);
  if (expected.error) {
    expect(actual.error?.constructor, `${label} error`).toBe(expected.error.constructor);
    expect(actual.error.message, label).toBe(expected.error.message);
    return expected;
  }
  expect(actual.error, label).toBeUndefined();
  expect(actual.yields, `${label} pauses`).toBe(expected.yields);
  exact(actual.value, expected.value, label);
  return expected;
}
const legacy = { id: 'lettering', strength: .6 };
const blank = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
const half = input => makeColorMaskImage({ ...input, width: Math.max(1, input.width >> 1), height: Math.max(1, input.height >> 1) });

describe('the build job is the frozen buildMapsFromPixels', () => {
  it('several layers: classification then composition, two jobs', () => {
    for (const input of [colorMaskCases[0], colorMaskCases[2], colorMaskCases[4], colorMaskCases[6], { width: 1, height: 1, kind: 'panels' }]) {
      const image = makeColorMaskImage(input), before = image.data.slice();
      for (const count of [2, 3, 5, 10]) expect(both(image, image, colorMaskSelection(count), `${input.width}x${input.height} layers ${count}`).jobs).toBe(2);
      both(image, image, colorMaskSelection(3, { overlap: true }), 'overlap');
      // Ticked in another order: the canonical order is the module's.
      both(image, image, { layers: [...colorMaskSelection(5).layers].reverse() }, 'reversed');
      exact(image.data, before, 'input');
    }
  });
  it('one saved colour: one job at map resolution', () => {
    for (const input of [colorMaskCases[0], colorMaskCases[3], colorMaskCases[6], { width: 7, height: 3, kind: 'noise' }]) {
      const image = makeColorMaskImage(input), small = half(input);
      for (const layer of colorMaskSelection(5).layers) expect(both(small, image, layer, `single ${layer.color}`).jobs).toBe(1);
      both(small, image, { id: 'color-3', color: '#A12638', tolerance: 6.004, strength: 2 }, 'normalised');
      both(small, image, { layers: [colorMaskSelection(1).layers[0]] }, 'a list of one');
    }
  });
  it('a legacy record: the palette of the working raster, then its first colour', () => {
    for (const input of [colorMaskCases[0], colorMaskCases[4], colorMaskCases[6]]) {
      const hires = makeColorMaskImage(input), work = half(input);
      expect(both(work, hires, legacy, `legacy ${input.name}`).jobs).toBe(2);
      for (const id of ['foil', 'frame', 'band', 'grain']) both(work, hires, { id, strength: 1 }, id);
    }
    // Nothing printed: no colour is found and the maps stay empty.
    const none = both(blank(12, 9), blank(24, 18), legacy, 'transparent');
    expect(none.jobs).toBe(1);
    expect(Object.keys(none.value)).toEqual(['width', 'height', 'heightMap', 'foil', 'gloss', 'mask', 'preserveInk', 'foilColor']);
  });
  it('refuses what the generators refused, with their errors, before or between jobs', () => {
    const image = makeColorMaskImage(colorMaskCases[0]);
    for (const selection of [null, undefined, {}, { id: 'nothing' }, { id: 'color-1', color: 'red', tolerance: 6 }, { layers: [] }, 7, 'color-1'])
      expect(both(image, image, selection, `selection ${JSON.stringify(selection)}`).error).toBeInstanceOf(TypeError);
    const choice = colorMaskSelection(3);
    for (const wrong of [null, undefined, {}, { ...image, width: 0 }, { ...image, height: 1.5 }, { ...image, data: null }, { ...image, data: image.data.subarray(4) }, { width: '64', height: 96, data: image.data }]) {
      expect(both(wrong, image, choice, 'work').error).toBeInstanceOf(TypeError);
      expect(both(image, wrong, choice, 'hires').error).toBeInstanceOf(TypeError);
      expect(both(wrong, image, legacy, 'legacy work').error).toBeInstanceOf(TypeError);
    }
    // Valid rasters the jobs themselves turn away (too large for a palette or map job).
    const big = blank(513, 512);
    expect(both(image, big, choice, 'large map').error).toBeInstanceOf(TypeError);
    expect(both(image, big, choice.layers[0], 'large single').error).toBeInstanceOf(TypeError);
    expect(both(big, image, legacy, 'large palette').error).toBeInstanceOf(TypeError);
    expect(both(image, big, legacy, 'large legacy map').error).toBeInstanceOf(TypeError);
  });
  it('one job lives at a time and a cancelled build frees it at any pause', () => {
    const image = makeColorMaskImage(colorMaskCases[1]);
    for (const selection of [colorMaskSelection(3), colorMaskSelection(1).layers[0], legacy]) {
      const total = drain(production.buildMapsFromPixels(image, image, selection)).yields;
      expect(total).toBe(drain(frozen.buildMapsFromPixels(image, image, selection)).yields);
      for (let stop = 0; stop <= total + 1; stop++) {
        const task = production.buildMapsFromPixels(image, image, selection);
        for (let i = 0; i < stop; i++) { if (task.next().done) break; expect(shelf.relief_jobs_live()).toBe(1); }
        task.return();
        expect(shelf.relief_jobs_live()).toBe(0);
      }
    }
  });
});
