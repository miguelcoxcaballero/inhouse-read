// @vitest-environment node
// The weave and the replay of the core's cloth plan are painted by the shelf module (rust-ui/src/spine_surface.rs).
// Compared with the frozen JavaScript (helpers/reference-spine-surface.js) through a recording canvas whose
// createPattern returns a pattern (the spine comparison's canvas has none, so it only reaches the tiles): every
// canvas made, every property write and call with its arguments, in order, for colour and channel weaves, cloth
// and metal plans and many widths.
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as production from '../../src/js/spine-surface.js';
import * as original from './helpers/reference-spine-surface.js';

let log, canvases, objects;
const show = value => {
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (value?.__canvas) return `canvas#${value.__canvas}`;
  if (value?.__object) return `object#${value.__object}`;
  if (value instanceof Uint8ClampedArray) { let h = 0; for (const byte of value) h = Math.imul(h ^ byte, 16777619); return `bytes:${value.length}:${h >>> 0}`; }
  return value === undefined ? 'undefined' : JSON.stringify(value);
};
function context(id, owner) {
  const target = {};
  return new Proxy(target, {
    get(_target, key) {
      if (key === 'canvas') return owner;
      if (key === 'createPattern') return (...args) => { const pattern = { __object:++objects }; log.push([id, key, ...args.map(show), show(pattern)]); return pattern; };
      if (key === 'createImageData') return (width, height) => {
        const image = { __object:++objects, width, height, data:new Uint8ClampedArray(width * height * 4) };
        image.data.set = new Proxy(image.data.set, { apply:(set, data, args) => { log.push([id, 'data.set', show(args[0])]); return Reflect.apply(set, data, args); } });
        log.push([id, key, show(width), show(height)]); return image;
      };
      if (key === 'putImageData') return (image, ...args) => log.push([id, key, show(image.data), ...args.map(show)]);
      return (...args) => log.push([id, key, ...args.map(show)]);
    },
    set(_target, key, value) { log.push([id, `=${String(key)}`, show(value)]); return true; }
  });
}
function canvas() {
  const id = ++canvases, node = { __canvas:id };
  let width = 300, height = 150, painter;
  Object.defineProperty(node, 'width', { get:() => width, set:value => { log.push([id, '=width', show(value)]); width = value; } });
  Object.defineProperty(node, 'height', { get:() => height, set:value => { log.push([id, '=height', show(value)]); height = value; } });
  node.getContext = type => { log.push([id, 'getContext', show(type)]); return painter ??= context(id, node); };
  return node;
}
let saved;
beforeEach(() => {
  saved = globalThis.document;
  globalThis.document = { createElement:tag => { log.push(['document', 'createElement', show(tag)]); return canvas(); } };
});
afterEach(() => { globalThis.document = saved; });

function run(module, paint) {
  log = []; canvases = 0; objects = 0;
  const target = canvas();
  let outcome;
  try { outcome = paint(module, target.getContext('2d')); } catch (error) { outcome = `${error.constructor.name}: ${error.message}`; }
  return { outcome:show(outcome), log };
}

it('lays the colour and channel weave like the original', () => {
  for (const [designWidth, options] of [[675.84, undefined], [675.84, { channels:true }], [128, {}], [1024, { channels:false }], [33.3, { channels:1 }]]) {
    const expected = run(original, (module, c) => module.paintWeave(c, designWidth, options));
    const actual = run(production, (module, c) => module.paintWeave(c, designWidth, options));
    expect(actual, `${designWidth} ${JSON.stringify(options)}`).toEqual(expected);
  }
  expect(production.WEAVE).toBe(original.WEAVE);
});

it('replays the cloth plans of the numeric core like the original', () => {
  for (let seed = 1; seed < 40; seed++) {
    for (const [designWidth, options] of [[675.84, undefined], [400 + seed * 7.25, { metal:true }], [96, { threads:false }], [seed * 31, {}]]) {
      const expected = run(original, (module, c) => module.paintCloth(c, designWidth, module.seededRandom(seed * 7919), options));
      const actual = run(production, (module, c) => module.paintCloth(c, designWidth, module.seededRandom(seed * 7919), options));
      expect(actual.log.length, `${seed} ${designWidth}`).toBe(expected.log.length);
      expect(actual, `${seed} ${designWidth} ${JSON.stringify(options)}`).toEqual(expected);
    }
  }
});
