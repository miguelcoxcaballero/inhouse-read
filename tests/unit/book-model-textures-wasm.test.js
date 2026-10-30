// The textures every book shares (cloth and paper tooth, the ribbon's swallowtail cut, the page edges and the
// endpaper) are built by the shelf module (rust-ui/src/book_model_build.rs). Each builder is compared with the
// frozen JavaScript it replaced (helpers/reference-book-model.js): the texture's class, sampler, colour space,
// version and source, the pixels it carries (byte for byte) or the canvas it was painted on, and every canvas
// operation of the painting.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getRustCore, loadedRustCore } from '../../src/js/rust-core.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { rustBookSurfacePixels, rustRibbonNotchPixels } from '../../src/js/book-surface-wasm.js';

const reference = await import('./helpers/reference-book-model.js');
const core = () => getRustCore() ?? loadedRustCore();
const host = { three:THREE, surfacePixels:kind => rustBookSurfacePixels(core(), kind),
  notchPixels:(width, height) => rustRibbonNotchPixels(core(), width, height) };

let log = [], canvases = 0;
const show = value => typeof value === 'number' ? (Object.is(value, -0) ? '-0' : String(value)) : value?.__canvas ? `canvas#${value.__canvas}` : JSON.stringify(value ?? null);
beforeEach(() => {
  log = []; canvases = 0;
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const node = createElement(tag, ...rest);
    if (String(tag).toLowerCase() === 'canvas') node.__canvas = ++canvases;
    return node;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(type) {
    const id = this.__canvas;
    log.push([id, 'getContext', type, this.width, this.height]);
    const gradient = () => ({ addColorStop:(...args) => log.push([id, 'stop', ...args.map(show)]) });
    return this._context ??= new Proxy({}, {
      get:(_target, key) => key === 'canvas' ? this : key === 'then' ? undefined
        : key === 'createLinearGradient' || key === 'createRadialGradient' ? (...args) => { log.push([id, key, ...args.map(show)]); return gradient(); }
        : key === 'createImageData' ? (width, height) => ({ width, height, data:new Uint8ClampedArray(width * height * 4) })
        : key === 'getImageData' ? (_x, _y, width, height) => ({ width, height, data:new Uint8ClampedArray(width * height * 4).fill(7) })
        : (...args) => { log.push([id, key, ...args.map(value => value?.data ? `bytes:${createHash('sha1').update(value.data).digest('hex')}` : show(value))]); },
      set:(_target, key, value) => { log.push([id, `=${String(key)}`, show(value)]); return true; }
    });
  });
});
afterEach(() => { vi.restoreAllMocks(); });

function describe(texture) {
  const image = texture.image;
  return { type:texture.constructor.name, keys:Object.keys(texture).filter(key => key !== 'uuid'),
    image:image?.data ? { width:image.width, height:image.height, data:createHash('sha1').update(image.data).digest('hex') }
      : image ? { canvas:image.__canvas, width:image.width, height:image.height } : null,
    ...Object.fromEntries(['mapping', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'format', 'type', 'colorSpace', 'flipY',
      'generateMipmaps', 'premultiplyAlpha', 'unpackAlignment', 'version', 'channel'].map(key => [key, texture[key]])),
    sourceVersion:texture.source.version, offset:texture.offset.toArray(), repeat:texture.repeat.toArray(), center:texture.center.toArray(),
    rotation:texture.rotation, userData:texture.userData };
}
function build(make) {
  log = []; canvases = 0;
  const texture = make();
  return { texture:describe(texture), painted:log };
}

it('builds the shared book textures exactly like the original', () => {
  const rust = needRustShelf();
  for (const [name, original, production] of [
    ['cloth', () => reference.referenceTileNormals('cloth'), () => rust.book_model_tile_normals(host, 'cloth')],
    ['paper', () => reference.referenceTileNormals('paper'), () => rust.book_model_tile_normals(host, 'paper')],
    ['notch', () => reference.referenceRibbonNotch(), () => rust.book_model_ribbon_notch(host)],
    ['pages 256', () => reference.referencePageEdgeAtlas(256), () => rust.book_model_page_edges(host, 256)],
    ['pages 512', () => reference.referencePageEdgeAtlas(512), () => rust.book_model_page_edges(host, 512)],
    ['endpaper', () => reference.referenceEndpaperTexture(), () => rust.book_model_endpaper(host)],
  ]) {
    const expected = build(original), actual = build(production);
    expect(actual.texture, name).toEqual(expected.texture);
    expect(actual.painted.length, `${name} canvas operations`).toBe(expected.painted.length);
    expect(actual.painted, name).toEqual(expected.painted);
  }
});

it('fails like the original when the numeric core gives no pixels', () => {
  const rust = needRustShelf(), empty = { three:THREE, surfacePixels:() => null, notchPixels:() => null };
  expect(() => rust.book_model_tile_normals(empty, 'cloth')).toThrow('El módulo numérico no pudo generar la textura del libro.');
  expect(() => rust.book_model_ribbon_notch(empty)).toThrow('El módulo numérico no pudo generar la muesca de la cinta.');
});
