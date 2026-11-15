// @vitest-environment node
// The core now moves a pinned record to its target, bounds each surface's rows and owns the answer
// (rust-core/src/shelf_placement.rs). Every move of a drag and every layout must come out as it did while
// the host did those three things (tests/unit/helpers/reference-shelf-placement-bridge.js).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import * as now from '../../src/js/shelf-placement-wasm.js';
import * as frozen from './helpers/reference-shelf-placement-bridge.js';
import { generatePlacement } from '../helpers/shelf-placement-cases.mjs';

let core;
beforeAll(async () => {
  core = await loadRustCore({ bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
  expect(typeof core?.shelf_place).toBe('function');
});
const xs = [0, 1, .5, 1e-9, 1 - 1e-9, .013, .987, .25, 2, -1, NaN];
const shelves = [0, 1, 2, 7, 999, 1500, -1, 2.7, NaN];

describe('placement jobs against the bridge that prepared them in the host', () => {
  it('answers every move of a drag identically, physical or not, at the edges and beyond them', () => {
    let moves = 0, pinned = 0;
    for (let seed = 0; seed < 90; seed++) {
      const input = generatePlacement(seed, 16 + (seed * 13) % 70, { unusual:seed % 3 === 0 });
      const options = { ...input.options, physicalPlacement:seed % 2 === 0 ? true : seed % 5 === 0 ? 'yes' : false };
      const a = frozen.createShelfPlacementSession(input.objects, options), b = now.createShelfPlacementSession(input.objects, options);
      expect(b === null).toBe(a === null);
      if (!a) continue;
      for (let step = 0; step < 40; step++) {
        const key = step % 9 === 0 ? 'missing' : input.objects[(step * 7 + seed) % input.objects.length]?.key;
        const shelf = shelves[(step + seed) % shelves.length], x = xs[(step * 3 + seed) % xs.length];
        const expected = a.move(core, key, shelf, x), actual = b.move(core, key, shelf, x);
        expect(actual).toEqual(expected);
        moves++; if (expected && key !== 'missing') pinned++;
      }
      a.dispose(); b.dispose();
    }
    expect(moves).toBeGreaterThan(3000); expect(pinned).toBeGreaterThan(1500);
  }, 60000);
  it('answers layouts and one-off moves identically', () => {
    for (let seed = 0; seed < 120; seed++) {
      const input = generatePlacement(seed, (seed * 11) % 90, { unusual:seed % 2 === 0 });
      const options = { ...input.options, physicalPlacement:seed % 3 === 0 };
      const run = api => {
        try { return { layout:api.placeObjects(core, input.objects, options),
          move:api.placeObjects(core, input.objects, options, { move:true, movedKey:input.movedKey, target:input.target }) }; }
        catch (error) { return { error:String(error) }; }
      };
      expect(run(now)).toEqual(run(frozen));
      for (const settings of [{}, { move:true, movedKey:input.movedKey, target:input.target },
        { separateMounts:true }, { separateMounts:true, move:true, movedKey:input.movedKey, target:input.target }]) {
        expect(now.rustShelfPlacement(core, input.objects, options, settings))
          .toEqual(frozen.rustShelfPlacement(core, input.objects, options, settings));
      }
    }
  });
  it('rejects what the host rejected: no core, a failed arena, a refused or trapped job', () => {
    const input = generatePlacement(4, 40), fake = overrides => ({ ...core, ...overrides });
    for (const broken of [null, fake({ alloc_f64:() => 0 }), fake({ shelf_place:() => 0 }),
      fake({ shelf_place() { throw new WebAssembly.RuntimeError('trap'); } })]) {
      const session = now.createShelfPlacementSession(input.objects, input.options);
      expect(session.move(broken, input.movedKey, 1, .4)).toBeUndefined();
      expect(session.move(core, input.movedKey, 1, .4)).toEqual(
        frozen.createShelfPlacementSession(input.objects, input.options).move(core, input.movedKey, 1, .4));
      session.dispose();
    }
  });
});
