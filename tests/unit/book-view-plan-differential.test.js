// A view's arithmetic runs inside the shelf module (rust-ui/src/book_view_plan.rs over rust-core/src/book_view.rs).
// Production (src/js/book-view-wasm.js) against the frozen bridge to the numeric core
// (helpers/reference-book-view-wasm.js): every answer, the write-backs and the lazy measurement, number for number.
import { describe, expect, it } from 'vitest';
import './helpers/rust-core-ready.js';
import * as production from '../../src/js/book-view-wasm.js';
import * as frozen from './helpers/reference-book-view-wasm.js';

let seed = 20261113;
const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
const pick = (...values) => values[Math.floor(random() * values.length)];
const number = (low, high) => pick(low + random() * (high - low), low + random() * (high - low), Math.round(low + random() * (high - low)), NaN, 0, -0, Infinity, undefined);
const matrix = () => Array.from({ length:16 }, (_, at) => at % 5 === 0 ? .5 + random() * 2 : (random() - .5) * (at > 11 ? 400 : .3));
const camera = () => ({ matrixWorldInverse:{ elements:matrix() }, projectionMatrix:{ elements:matrix() } });
const point = () => ({ x:(random() - .5) * 300, y:(random() - .5) * 400, z:(random() - .5) * 80 });
const exact = (actual, expected, label) => {
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual), label).toEqual(Object.keys(expected));
    for (const key of Object.keys(expected)) exact(actual[key], expected[key], `${label}.${key}`);
  } else expect(Object.is(actual, expected), `${label}: ${actual} vs ${expected}`).toBe(true);
};
const both = (label, run) => exact(run(production), run(frozen), label);

describe('the view planner of the shelf module against the frozen bridge to the numeric core', () => {
  it('sizes, poses, fits, zooms and reading poses over 20,000 random views', () => {
    for (let i = 0; i < 20000; i++) {
      const view = { shelf:pick(true, false, 0, 1), devicePixelRatio:pick(1, 2, 2.625, 3, undefined, '2'), innerWidth:number(300, 2000), viewportWidth:number(300, 2000),
        viewportHeight:number(400, 1400), width:number(40, 400), height:number(60, 500), thickness:number(4, 120) };
      both(`view ${i}`, api => api.planBookView(view));
      const pose = { x:number(0, 400), y:number(0, 800), angle:number(-2, 2), scale:number(.2, 3), pitch:pick(undefined, random()), roll:pick(undefined, random()),
        coverOpen:pick(undefined, random() * 1.4 - .2), bookmarkWithdraw:pick(undefined, random()), pageTheme:pick(undefined, null, 0, 1, random(), '0.5') };
      const current = pick(undefined, null, { coverOpen:random(), bookmarkWithdraw:random() });
      const numbers = [number(0, 400), number(0, 800), number(300, 2000), number(400, 1400), pick(0, 1, random())];
      both(`pose ${i}`, api => api.planBookPose(pose, current, ...numbers));
      const sizes = [number(1, 2000), number(1, 2000), number(1, 1024), number(1, 1024)];
      both(`fit ${i}`, api => api.fitImage(...sizes));
      const reading = Array.from({ length:7 }, () => number(1, 1500));
      both(`reading ${i}`, api => api.planReadingPose(...reading));
      const rectangle = () => pick({ left:number(0, 300), top:number(0, 600), width:number(0, 400), height:number(0, 700) }, null, undefined);
      const bounds = rectangle() ?? { left:0, top:0, width:10, height:10 }, target = rectangle(), offset = { left:number(0, 20), top:number(0, 20) };
      const origin = { x:number(0, 300), y:number(0, 600), scale:number(.2, 3) }, centre = [number(0, 400), number(0, 800)];
      both(`zoom ${i}`, api => api.planPageZoom(bounds, target, offset, ...centre, origin));
    }
  });

  it('projected bounds of boxes and pages over 10,000 cameras', () => {
    for (let i = 0; i < 10000; i++) {
      const eye = camera(), boxes = Array.from({ length:Math.floor(random() * 4) }, () => ({ min:point(), max:point(), matrix:pick(undefined, matrix()) }));
      const offset = pick(undefined, { left:random() * 30, top:random() * 30 }, {}), viewport = [number(300, 2000), number(400, 1400)];
      both(`boxes ${i}`, api => api.boxScreenBounds(boxes, eye, ...viewport, offset));
      const world = matrix(), size = [number(40, 400), number(60, 500)], shift = { left:number(0, 30), top:number(0, 30) };
      both(`page ${i}`, api => api.planPageBounds(...size, ...viewport, shift, world, eye));
    }
  });

  it('return frames and copy rectangles: the answer, the reservations written back and when the book is measured', () => {
    for (let i = 0; i < 20000; i++) {
      const flag = () => pick(true, false), size = () => pick({ width:Math.round(random() * 900), height:Math.round(random() * 1200) }, null, { width:0, height:0 });
      const base = { compact:flag(), direct:flag(), adaptive:flag(), measureOnly:flag(), scale:pick(1, 1, .5, 2, random() * 3), ratio:pick(1, 2, 3, 2.625),
        viewportWidth:pick(390, 412, 1280, 800.5), viewportHeight:pick(844, 915, 720), coverOpen:pick(0, 1, random()), closedWidth:pick(192, 96, 250.5),
        openWidth:pick(576, 288), height:pick(448, 224, 300.25) };
      const measured = pick([10, 20, 300, 400], [-50, -20, 500, 900], [0, 0, 0, 0], [NaN, 0, 10, 10], [100.5, 200.25, 180.75, 420.5], [Infinity, -Infinity, 0, 0]);
      const run = api => {
        const input = { ...base, motion:motion && { ...motion }, native:native && { ...native } };
        let asked = 0;
        const frame = api.planReturnFrame(input, () => { asked++; return measured; });
        return { frame, asked, motion:input.motion, native:input.native };
      };
      const motion = size(), native = size();
      both(`frame ${i}`, run);
      const copy = { viewportWidth:base.viewportWidth, viewportHeight:base.viewportHeight, ratio:base.ratio, canvasWidth:Math.round(base.viewportWidth * base.ratio),
        canvasHeight:Math.round(base.viewportHeight * base.ratio), frame:{ x:Math.round(random() * 200), y:Math.round(random() * 300), width:Math.round(random() * 600), height:Math.round(random() * 900) },
        scale:base.scale };
      both(`copy ${i}`, api => { let asked = 0; return { rectangle:api.planCopyRectangle(copy, () => { asked++; return measured; }), asked }; });
      both(`aligned ${i}`, api => api.frameAligned(base.viewportWidth, base.viewportHeight, base.ratio, copy.frame.x, copy.frame.y / 2, copy.frame.width, copy.frame.height / 3));
    }
  });

  it('a measurement in the middle of a plan may run other plans', () => {
    const input = () => ({ compact:true, direct:true, adaptive:true, measureOnly:false, scale:1, ratio:2, viewportWidth:390, viewportHeight:844, coverOpen:1,
      closedWidth:192, openWidth:576, height:448, motion:{ width:0, height:0 }, native:{ width:64, height:64 } });
    const eye = camera(), box = { min:point(), max:point(), matrix:matrix() };
    both('nested', api => api.planReturnFrame(input(), () => {
      api.planBookPose({ x:1, y:2, scale:1, angle:0 }, undefined, 0, 0, 100, 100, 1);
      api.planReturnFrame({ ...input(), measureOnly:true }, () => [1, 2, 3, 4]);
      return api.boxScreenBounds([box], eye, 390, 844);
    }));
  });
});
