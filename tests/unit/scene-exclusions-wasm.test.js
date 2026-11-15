// @vitest-environment node
import { expect, it } from 'vitest';
import { rustShelf } from './helpers/rust-shelf-ready.js';
import { exclusionRects, prepareAreas } from './helpers/reference-foliage-areas.js';
import { createFoliageFrame } from './helpers/foliage-frame.js';
import { createSceneEntryFrame, ENTRY_OUTPUT, ENTRY_STATE, HIT_INPUT, HIT_OUTPUT } from '../../src/js/scene-entry-frame.js';

// The foliage's exclusion rectangles, gathered from the entry arena in Rust, against the frozen
// JavaScript that gathered them from the entries: the same rectangles, bit for bit and in the
// same order, and the same revisions of the foliage arena (a clip is rebuilt exactly when it was).
const SPECIAL = [0, -0, NaN, Infinity, -Infinity, 1e-9, 5e-324, -1e300];
it('gathers the rectangles the frozen scene gathered, in both views', () => {
  let seed = 7331;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const number = () => random() < .06 ? SPECIAL[Math.floor(random() * SPECIAL.length)] : (random() - .5) * 3000;
  for (let trial = 0; trial < 40; trial++) {
    const count = trial === 0 ? 0 : 1 + Math.floor(random() * 60);
    const entryFrame = createSceneEntryFrame(rustShelf), old = createFoliageFrame(rustShelf), now = createFoliageFrame(rustShelf);
    const entries = Array.from({ length:count }, () => ({ row:-1 }));
    entryFrame.bind(entries, false);
    const model = Array.from({ length:count }, () => ({ visible:false }));
    for (let frame = 0; frame < 30; frame++) {
      entryFrame.refresh();
      const { state, output, hitInput, hitOutput } = entryFrame;
      for (let index = 0; index < count; index++) {
        // Most frames move a few entries only: the arena's revision must stand when nothing did.
        if (frame && random() < .8) continue;
        const entry = entries[index], kind = Math.floor(random() * 3), bits = Math.floor(random() * 16), button = random() < .85;
        entry.kind = ['book', 'plant', 'lamp'][kind];
        entry.model = random() < .9 ? model[index] : null; model[index].visible = random() < .8;
        entry.flags = { away:Boolean(bits & 1), dragging:Boolean(bits & 2), lifted:Boolean(bits & 4), pressed:Boolean(bits & 8) };
        entry.rect = { left:number(), right:number(), top:number(), bottom:number(), width:number(), height:number(), closest:number() };
        entry.hitRect = button ? { left:number(), right:number(), top:number(), bottom:number(), width:number(), height:number(), closest:number() } : null;
        state[index * ENTRY_STATE] = kind; state[index * ENTRY_STATE + 2] = bits;
        const out = index * ENTRY_OUTPUT + 58, hit = index * HIT_OUTPUT + 1;
        for (const [at, key] of ['left', 'right', 'top', 'bottom', 'width', 'height', 'closest'].entries()) {
          output[out + at] = entry.rect[key]; hitOutput[hit + at] = button ? entry.hitRect[key] : number();
        }
        hitInput[index * HIT_INPUT] = (button ? 1 | Math.floor(random() * 32) * 2 : 0) | (entry.model?.visible ? 64 : 0);
      }
      const progress = [0, .04, .041, 1, random()][Math.floor(random() * 5)];
      prepareAreas(old, exclusionRects(entries, progress));
      entryFrame.exclusions(now.native, progress > .04);
      const expected = new Float64Array(old.native.memory().buffer, old.native.input_ptr(), old.native.count * 4);
      const actual = new Float64Array(now.native.memory().buffer, now.native.input_ptr(), now.native.count * 4);
      expect(now.native.count, `trial ${trial} frame ${frame}`).toBe(old.native.count);
      for (let at = 0; at < expected.length; at++) if (!Object.is(actual[at], expected[at])) throw new Error(`trial ${trial} frame ${frame} number ${at}: expected ${expected[at]}, got ${actual[at]}`);
    }
    entryFrame.free(); old.free(); now.free();
  }
});
