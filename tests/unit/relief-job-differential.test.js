// @vitest-environment node
// The relief passes are jobs of the shelf module (rust-ui/src/relief_job.rs). This is the guard that let
// src/js/cover-relief-wasm.js go: every production pass is compared with the frozen bridge to the numeric core
// (helpers/reference-cover-relief-wasm.js), byte for byte, key for key and pause for pause, and every job made
// is counted and seen freed.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import * as production from '../../src/js/cover-relief.js';
import * as frozen from './helpers/reference-cover-relief-wasm.js';
import { mapsFor, layers } from '../helpers/cover-relief-reference.mjs';
import { makeColorMaskImage, colorMaskCases, colorMaskSelection } from '../helpers/color-mask-cases.mjs';

let core, shelf;
beforeAll(async () => {
  core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
  shelf = needRustShelf();
});
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
const same = (actual, expected, label) => { expect(actual.yields, `${label} pauses`).toBe(expected.yields); exact(actual.value, expected.value, label); };
/** One production job, stepped like cover-relief.js steps it. */
function* job(make) { const made = make(shelf.ReliefJob); try { for (let code; (code = made.step()) !== 0;) { if (code < 0) throw made.error(); yield; } return made.result(); } finally { made.free(); } }
const unitOf = (maps, gain = 1) => shelf.relief_normal_unit(maps.width, maps.height, gain);
const SHAPES = [[1, 1], [3, 5], [7, 16], [7, 17], [47, 1], [1, 35], [64, 65], [193, 128], [512, 512]];
function variants(width, height) {
  const out = [];
  for (const owners of [false, true]) for (const preserve of [false, true]) for (const masked of [false, true]) {
    if (preserve && !masked) continue;
    const maps = mapsFor(width, height, 19 + width, owners);
    maps.preserveInk = preserve;
    if (!masked) delete maps.mask;
    out.push(maps);
  }
  return out;
}

describe('every relief pass of the shelf module is the frozen bridge to the core', () => {
  it('analysis: proposals, masks and pauses', () => {
    for (const input of [...colorMaskCases.slice(0, 5), { width: 1, height: 1, kind: 'panels' }, { width: 40, height: 33, kind: 'alpha' }, { width: 288, height: 192, kind: 'noise' }]) {
      const image = makeColorMaskImage(input), before = image.data.slice();
      const expected = drain((function* () { return shelf.relief_analysis_result(yield* frozen.wasmAnalyze(core, image)); })());
      const made = shelf.relief_jobs_made();
      same(drain(production.analyzePixels(image)), expected, `analysis ${input.width}x${input.height} ${input.kind}`);
      expect(shelf.relief_jobs_made() - made).toBe(1);
      exact(image.data, before, 'input');
    }
  });
  it('pigment maps: single colour and 1 to 10 layers', () => {
    for (const input of [colorMaskCases[0], colorMaskCases[2], colorMaskCases[4], { width: 1, height: 1, kind: 'panels' }, { width: 171, height: 256, kind: 'alpha' }]) {
      const image = makeColorMaskImage(input);
      for (const count of [1, 2, 3, 5, 10]) {
        const classified = shelf.relief_classification_layers(shelf.relief_sorted_layers(colorMaskSelection(count)));
        same(drain(job(Job => Job.maps(image, classified, false))), drain(frozen.wasmMaps(core, image, classified, false)), `layers ${count}`);
      }
      for (const overlap of [false, true]) {
        const choice = colorMaskSelection(3, { overlap }).layers[1], one = [{ color: choice.color, tolerance: choice.tolerance }];
        same(drain(job(Job => Job.maps(image, one, true))), drain(frozen.wasmMaps(core, image, one, true)), 'single');
      }
    }
  });
  for (const [width, height] of SHAPES) it(`normals, material, composition and the fused render at ${width}x${height}`, () => {
    for (const maps of variants(width, height)) {
      const originals = structuredClone(maps);
      for (const selectionAlpha of [false, true]) for (const gain of [1, 0, 3.7]) {
        const unit = unitOf(maps, gain);
        same(drain(production.heightToNormals(maps, { gain, selectionAlpha })), drain(frozen.wasmHeightToNormals(core, maps, unit, { selectionAlpha })), 'normals');
      }
      for (const finish of [{}, { clearcoat: .6, roughness: .32, clearcoatRoughness: .08 }, { clearcoat: 0, roughness: 1 }]) {
        const { clearcoat = 0, roughness = .5, clearcoatRoughness = .18 } = finish;
        const options = shelf.relief_material_options(maps.layers, clearcoat, roughness, clearcoatRoughness);
        same(drain(production.composeMaterialMap(maps, finish)), drain(frozen.wasmComposeMaterialMap(core, maps, options)), 'material');
      }
      for (const selectionAlpha of [false, true]) {
        const actual = drain(job(Job => Job.render(maps, unitOf(maps), selectionAlpha, true, null)));
        const expected = drain(frozen.wasmRenderRelief(core, maps, unitOf(maps), { selectionAlpha, rgba: true }));
        same(actual, expected, 'render');
        expect(expected.value.pixels).toBe(maps);
        expect(actual.value.pixels, 'an uncomposed render hands the same maps back').toBe(maps);
      }
      exact(shelf.relief_planes_rgba(maps), frozen.wasmReliefRgbaPlanes(core, maps), 'planes');
      if (maps.owners) for (const strength of [0, .01, .5, 1]) {
        const selection = { layers: layers.map((layer, index) => ({ ...layer, strength: index % 2 ? strength : 1 - strength })) };
        const chosen = shelf.relief_selected_layers(maps, selection);
        same(drain(production.composeReliefLayerPixels(maps, selection)), drain(frozen.wasmComposeReliefLayers(core, maps, chosen)), 'compose');
        for (const selectionAlpha of [false, true]) for (const rgba of [false, true]) {
          same(drain(job(Job => Job.render(maps, unitOf(maps), selectionAlpha, rgba, chosen))),
            drain(frozen.wasmRenderRelief(core, maps, unitOf(maps), { layers: chosen, selectionAlpha, rgba })), 'composed render');
        }
      }
      for (const key of ['heightMap', 'mask', 'owners', 'gloss', 'foil', 'baseMask', 'baseHeight']) if (originals[key]) exact(maps[key], originals[key], `input ${key}`);
    }
  });
  it('preview card: every size pair, ink kept or not, any slope', () => {
    for (const [w, h, mw, mh] of [[1, 1, 1, 1], [17, 7, 19, 11], [17, 8, 9, 5], [19, 17, 23, 11], [96, 64, 96, 64], [288, 384, 512, 512]]) for (const preserve of [false, true]) {
      const image = makeColorMaskImage({ width: w, height: h, kind: 'noise' }), maps = mapsFor(mw, mh, 7 + w, false);
      maps.preserveInk = preserve;
      for (const slope of [7, 2.2, 0, -1, 1000]) {
        same(drain(production.shadePreview(image, maps, { slope })), drain(frozen.wasmShadePreview(core, image, maps, shelf.relief_shade_scale(slope))), `preview ${w}x${h}`);
      }
    }
  });
});

describe('lifetime and refusal of the jobs', () => {
  it('frees the job when a pass is cancelled at any pause', () => {
    const maps = mapsFor(64, 65, 3, true), image = makeColorMaskImage({ width: 40, height: 33, kind: 'panels' });
    const chosen = shelf.relief_selected_layers(maps, { layers });
    const passes = [() => production.analyzePixels(image), () => production.buildMapsFromPixels(image, image, colorMaskSelection(3)),
      () => production.heightToNormals(maps, { selectionAlpha: true }), () => production.composeMaterialMap(maps),
      () => production.composeReliefLayerPixels(maps, { layers }), () => production.shadePreview(image, maps),
      () => job(Job => Job.render(maps, unitOf(maps), true, true, chosen))];
    for (const pass of passes) {
      const total = drain(pass()).yields;
      for (let stop = 0; stop <= total + 1; stop++) {
        const task = pass();
        for (let i = 0; i < stop; i++) if (task.next().done) break;
        if (stop <= total && stop > 0) expect(shelf.relief_jobs_live()).toBe(1);
        task.return();
        expect(shelf.relief_jobs_live()).toBe(0);
      }
    }
  });
  it('turns away what the frozen bridge turned away, as an error, without making a job', () => {
    const maps = mapsFor(17, 19, 5, true), made = shelf.relief_jobs_made();
    for (const wrong of [{ ...maps, width: 0 }, { ...maps, height: 1.5 }, { ...maps, width: 2048, height: 2048 }, { ...maps, heightMap: new Uint8Array(1) },
      { ...maps, mask: new Uint8Array(1) }, { ...maps, heightMap: [] }]) {
      expect(drain(frozen.wasmHeightToNormals(core, wrong, .003)).value).toBeNull();
      expect(() => drain(production.heightToNormals(wrong))).toThrow(/núcleo de relieve/);
      expect(drain(frozen.wasmRenderRelief(core, wrong, .003, { rgba: true })).value).toBeNull();
      expect(() => shelf.ReliefJob.render(wrong, .003, false, true, null)).toThrow(/núcleo de relieve/);
    }
    for (const wrong of [{ ...maps, width: 0 }, { ...maps, foil: new Uint8Array(1) }, { ...maps, gloss: [] }]) {
      expect(frozen.wasmReliefRgbaPlanes(core, wrong)).toBeNull();
      expect(() => production.reliefPlanesToRgba(wrong)).toThrow(/núcleo de relieve/);
    }
    expect(drain(frozen.wasmRenderRelief(core, maps, NaN)).value).toBeNull();
    expect(() => shelf.ReliefJob.render(maps, NaN, false, false, null)).toThrow(/núcleo de relieve/);
    const image = makeColorMaskImage({ width: 8, height: 4, kind: 'panels' });
    for (const list of [[], Array.from({ length: 11 }, () => ({ color: '#102030', tolerance: 6 })), null]) {
      expect(drain(frozen.wasmMaps(core, image, list ?? [], false)).value).toBeNull();
      expect(() => shelf.ReliefJob.maps(image, list, false)).toThrow(/núcleo de relieve/);
    }
    const big = { width: 513, height: 512, data: new Uint8ClampedArray(513 * 512 * 4) };
    expect(drain(frozen.wasmAnalyze(core, big)).value).toBeNull();
    expect(() => drain(production.analyzePixels(big))).toThrow(/núcleo de relieve/);
    expect(shelf.relief_jobs_made()).toBe(made);
  });
  it('owns its results: independent buffers that outlive the job and other jobs', () => {
    const maps = mapsFor(129, 65, 23, true), chosen = shelf.relief_selected_layers(maps, { layers });
    const out = drain(job(Job => Job.render(maps, unitOf(maps), true, true, chosen))).value;
    const buffers = ['normal', 'height', 'foil', 'gloss'].map(key => out[key].buffer);
    expect(new Set(buffers).size).toBe(4);
    const kept = out.normal.slice();
    drain(job(Job => Job.render(mapsFor(512, 512, 5, true), .001, false, true, null)));
    exact(out.normal, kept, 'normal after another job');
  });
});
