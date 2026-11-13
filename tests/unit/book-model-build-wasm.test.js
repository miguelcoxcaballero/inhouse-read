// A book model is assembled by the shelf module (rust-ui/src/book_model_build.rs). Compared with the frozen
// JavaScript it replaced (helpers/reference-book-model.js): the whole object graph (every object, its
// order, names, poses, visibility and render order; every geometry's attributes, index, groups and
// parameters byte for byte; every material's own properties, version, shader hooks, program key and
// uniforms; every texture's sampler, colour space, version and source; the relative creation order of
// objects, materials, geometries and textures, which three's render lists sort by), every canvas
// operation the model paints, and the model's methods and their results, over the detail levels, real
// and random books, page snapshots, appearance changes, bookmarks, cover images and disposal.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const images = vi.hoisted(() => ({ pending:[], mode:'sync', released:0 }));
vi.mock('../../src/js/book-cover-images.js', async original => ({ ...await original(),
  acquireCoverImage:(url, onImage, onError) => {
    const deliver = () => {
      if (url.includes('broken')) onError(new Error('decode'));
      else onImage({ width:url.includes('wide') ? 900 : 400, height:600, tag:url }, { url });
    };
    if (images.mode === 'sync') deliver(); else images.pending.push(deliver);
    return () => { images.released++; };
  } }));

const production = await import('../../src/js/book-model.js');
const reference = await import('./helpers/reference-book-model.js');

function random(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

// ---- canvas recorder: every call and property write, with canvases and gradients by creation order ------
let log = [], canvasIds = new WeakMap(), canvasCount = 0, canvasBase = 0;
// Canvases and gradients made during the build by creation order; older ones (shared rasters) by identity.
const canvasName = node => {
  const id = canvasIds.get(node), [kind, number] = typeof id === 'number' ? ['', id] : [id[0], Number(id.slice(1))];
  return number < canvasBase ? `${kind}old${number}` : `${kind}${number - canvasBase}`;
};
const label = value => {
  if (value && typeof value === 'object' && canvasIds.has(value)) return `#${canvasName(value)}`;
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (value instanceof Uint8ClampedArray || value instanceof Uint8Array) return `bytes:${createHash('sha1').update(value).digest('hex')}`;
  if (value && typeof value === 'object') return JSON.stringify(Object.keys(value));
  return JSON.stringify(value) ?? String(value);
};
function recordingContext(canvas) {
  const id = canvasName(canvas);
  const target = {
    measureText: text => ({ width:String(text).length * 9.5 }),
    createLinearGradient: (...args) => { const g = { addColorStop:(...stop) => log.push([id, 'stop', ...stop.map(label)]) }; canvasIds.set(g, `g${canvasCount++}`); log.push([id, 'linear', ...args.map(label), label(g)]); return g; },
    createRadialGradient: (...args) => { const g = { addColorStop:(...stop) => log.push([id, 'stop', ...stop.map(label)]) }; canvasIds.set(g, `g${canvasCount++}`); log.push([id, 'radial', ...args.map(label), label(g)]); return g; },
    createPattern: (...args) => { const p = {}; canvasIds.set(p, `p${canvasCount++}`); log.push([id, 'pattern', ...args.map(label)]); return p; },
    getImageData: (_x, _y, width, height) => ({ data:new Uint8ClampedArray(width * height * 4).map((_, i) => (i * 37 + width) & 255), width, height }),
    createImageData: (width, height) => ({ data:new Uint8ClampedArray(width * height * 4), width, height }),
    putImageData: (image, ...args) => log.push([id, 'putImageData', label(image.data), ...args.map(label)]),
  };
  const context = new Proxy(target, {
    get:(object, key) => {
      if (key in object) { const value = object[key]; return typeof value === 'function' ? (...args) => { if (!['createLinearGradient','createRadialGradient','createPattern','putImageData'].includes(key)) log.push([id, key, ...args.map(label)]); return value(...args); } : value; }
      if (key === 'canvas') return canvas;
      if (key === 'then') return undefined;
      return (...args) => { log.push([id, key, ...args.map(label)]); };
    },
    set:(object, key, value) => { log.push([id, '=' + String(key), label(value)]); object[key] = value; return true; }
  });
  return context;
}

// ---- object graph ------------------------------------------------------------------------------------
const hash = array => createHash('sha1').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const shaderSources = { vertexShader:THREE.ShaderLib.physical.vertexShader, fragmentShader:THREE.ShaderLib.physical.fragmentShader };
function describeGraph(root, base) {
  const seen = new Map();
  const tag = (kind, value) => { if (!seen.has(value)) seen.set(value, `${kind}${seen.size}`); return seen.get(value); };
  const value = (item, depth = 0) => {
    if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'string') return item ?? String(item);
    if (typeof item === 'number') return Object.is(item, -0) ? '-0' : Number.isNaN(item) ? 'NaN' : item;
    if (typeof item === 'function') return 'function';
    if (item instanceof Promise) return 'promise';
    if (ArrayBuffer.isView(item)) return `${item.constructor.name}:${item.length}:${hash(item)}`;
    if (item.isColor) return ['color', item.r, item.g, item.b];
    if (item.isVector2 || item.isVector3 || item.isVector4 || item.isEuler || item.isQuaternion) return [item.constructor.name, ...item.toArray()];
    if (item.isMatrix3 || item.isMatrix4) return [item.constructor.name, ...item.elements];
    if (item.isTexture) return texture(item);
    if (item.isMaterial) return material(item);
    if (item.isBufferGeometry) return geometry(item);
    if (item.isObject3D) return tag('object', item);
    if (typeof HTMLCanvasElement !== 'undefined' && item instanceof HTMLCanvasElement) return `canvas#${canvasName(item)}:${item.width}x${item.height}`;
    if (Array.isArray(item)) return item.map(entry => value(entry, depth + 1));
    if (depth > 4) return 'deep';
    if (item instanceof Set) return ['set', ...[...item].map(entry => value(entry, depth + 1))];
    return Object.fromEntries(Object.keys(item).map(key => [key, value(item[key], depth + 1)]));
  };
  const texture = item => {
    if (seen.has(item)) return seen.get(item);
    const name = tag('texture', item);
    return { name, type:item.constructor.name, id:item.id - base.texture, source:tag('source', item.source), sourceVersion:item.source.version,
      image:value(item.image && (item.image.data ? { width:item.image.width, height:item.image.height, data:item.image.data } : item.image)),
      ...Object.fromEntries(['mapping','wrapS','wrapT','magFilter','minFilter','anisotropy','format','type','colorSpace','flipY','generateMipmaps',
        'premultiplyAlpha','unpackAlignment','version','channel','userData'].map(key => [key, value(item[key])])),
      offset:value(item.offset), repeat:value(item.repeat), center:value(item.center), rotation:item.rotation };
  };
  const material = item => {
    if (seen.has(item)) return seen.get(item);
    const name = tag('material', item), out = { name, type:item.type, id:item.id - base.material };
    for (const key of Object.keys(item)) if (key !== 'uuid' && key !== 'onBeforeCompile' && key !== 'customProgramCacheKey') out[key] = value(item[key], 1);
    out.programKey = item.customProgramCacheKey();
    const shader = { uniforms:{}, ...shaderSources };
    item.onBeforeCompile.call(item, shader, null);
    out.shader = { vertex:createHash('sha1').update(shader.vertexShader).digest('hex'), fragment:createHash('sha1').update(shader.fragmentShader).digest('hex'),
      uniforms:value(shader.uniforms, 1) };
    return out;
  };
  const geometry = item => {
    if (seen.has(item)) return seen.get(item);
    const name = tag('geometry', item);
    return { name, type:item.type, id:item.id - base.geometry, parameters:value(item.parameters),
      attributes:Object.entries(item.attributes).map(([key, attribute]) => [key, attribute.constructor.name, attribute.itemSize, attribute.normalized,
        value(attribute.array), attribute.version, attribute.usage]),
      index:item.index && [item.index.constructor.name, value(item.index.array), item.index.version], groups:item.groups,
      drawRange:item.drawRange, boundingBox:value(item.boundingBox), boundingSphere:value(item.boundingSphere), userData:value(item.userData) };
  };
  const node = object => ({ id:object.id - base.object, tag:tag('object', object), type:object.type, name:object.name, visible:object.visible,
    renderOrder:object.renderOrder, castShadow:object.castShadow, receiveShadow:object.receiveShadow, frustumCulled:object.frustumCulled,
    position:object.position.toArray(), rotation:object.rotation.toArray(), scale:object.scale.toArray(), layers:object.layers.mask,
    geometry:object.geometry ? geometry(object.geometry) : null, material:object.material ? value(object.material) : null,
    userData:Object.keys(object.userData).map(key => [key, value(object.userData[key], 1)]),
    children:object.children.map(node) });
  return node(root);
}
const bases = () => ({ object:new THREE.Object3D().id + 1, material:new THREE.Material().id + 1,
  geometry:new THREE.BufferGeometry().id + 1, texture:new THREE.Texture().id + 1 });

// Build with one module and record everything; `act` exercises the model afterwards.
async function run(module, args, act = async () => {}) {
  canvasBase = canvasCount;
  const startLog = log.length, base = bases();
  const model = module.createBookModel(...args);
  const steps = [['built', describeGraph(model, base)]];
  await act(model, (name, result) => steps.push([name, value(result), describeGraph(model, base)]));
  const painted = log.slice(startLog);
  return { steps, painted };
}
const value = result => result instanceof Promise ? 'promise' : result === undefined ? 'undefined' : JSON.parse(JSON.stringify(result ?? null));
async function compare(args, act, label) {
  await new Promise(resolve => setTimeout(resolve));
  const expected = await run(reference, args, act);
  await new Promise(resolve => setTimeout(resolve));
  const actual = await run(production, args, act);
  expect(actual.steps.length, label).toBe(expected.steps.length);
  for (let i = 0; i < expected.steps.length; i++) {
    const [name] = expected.steps[i];
    const a = JSON.stringify(actual.steps[i]), e = JSON.stringify(expected.steps[i]);
    if (a !== e) {
      // Point at the first differing character for a readable failure.
      let at = 0; while (a[at] === e[at]) at++;
      throw new Error(`${label}, step ${name}: ...${a.slice(Math.max(0, at - 300), at + 200)}\n  expected ...${e.slice(Math.max(0, at - 300), at + 200)}`);
    }
  }
  expect(actual.painted.length, `${label} canvas operations`).toBe(expected.painted.length);
  for (let i = 0; i < expected.painted.length; i++) {
    if (JSON.stringify(actual.painted[i]) !== JSON.stringify(expected.painted[i])) throw new Error(`${label}, canvas operation ${i}: ${JSON.stringify(actual.painted[i])} / ${JSON.stringify(expected.painted[i])}`);
  }
  return actual;
}

beforeEach(() => {
  log = []; images.pending = []; images.mode = 'sync';
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const node = createElement(tag, ...rest);
    if (String(tag).toLowerCase() === 'canvas') canvasIds.set(node, canvasCount++);
    return node;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function() { return this._context ??= recordingContext(this); });
});
afterEach(() => { vi.restoreAllMocks(); });

const books = [
  [{ id:'b1', title:'A printed cover', author:'An author', format:'EPUB', coverFinish:'glossy', spineFinish:'gold', spineSurfaceFinish:'satin', pageEdgeFinish:'matte' },
    { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:40, fontFamily:'Lora', fontWeight:600 }],
  [{ id:'b2', shelfVisualId:'v2', title:'Le Rouge et le Noir', author:'Stendhal', progress:.42, locator:'epubcfi(/6/4)', coverFinish:'matte', spineEngraved:true },
    { color:'#7a1f24', shade:'#5a1418', ink:'#f3e2b0', coverRatio:.7, fontCanvasFamily:'Playfair Display', fontFallback:'serif' }],
  [{ id:'b3', title:'', author:'', progress:1, locator:'x', spineFinish:'silver', coverRelief:{ id:'color-1', color:'#d4a93c', tolerance:4, strength:.75 } },
    { color:'#1d2b44', shade:'#141e30', ink:'#d8c48c', coverRatio:.62 }],
];
const levels = [{ shelf:true, overview:true }, { shelf:true }, { shelf:true, inspectionResolution:1024 }, {}, { eagerRelief:false }, { shelf:true, inspectionResolution:2048, eagerRelief:false }];

it('builds every detail level of real books exactly like the original', async () => {
  // Warm the shared rasters (page edges, endpaper, normals, notch) once for both modules.
  for (const [book, style] of books) for (const options of levels) for (const module of [reference, production]) {
    for (const url of [null, 'blob:warm']) module.createBookModel(book, style, 132, 200, 30, url, options);
  }
  for (const [book, style] of books) for (const options of levels) {
    await compare([book, style, 132, 200, 30, null, options], undefined, `${book.id} ${JSON.stringify(options)}`);
  }
}, 120_000);

it('builds random books and sizes exactly like the original', async () => {
  const next = random(77);
  for (let trial = 0; trial < 40; trial++) {
    const height = 80 + next() * 600, width = height * (.45 + next() * .5), thickness = 4 + next() * 70;
    const book = { id:`r${trial}`, title:['Ulysses', 'Война и мир', 'A very long title that will not fit on one spine line at all', '一', 'Lone \ud800 and \ufffd'][trial % 5],
      author:trial % 3 ? 'Some Author' : '', progress:trial % 5 ? next() : undefined, locator:trial % 2 ? 'loc' : undefined,
      coverFinish:['matte', 'satin', 'glossy', undefined][trial % 4], spineFinish:['matte', 'gold', 'silver'][trial % 3],
      spineSurfaceFinish:['matte', 'satin', 'glossy'][trial % 3], pageEdgeFinish:['glossy', 'satin', undefined][trial % 3] };
    const style = { color:`#${Math.floor(next() * 0xffffff).toString(16).padStart(6, '0')}`, ink:'#ffffff', coverRatio:.5 + next() * .4, fontWeight:trial % 2 ? 700 : undefined };
    await compare([book, style, width, height, thickness, null, levels[trial % levels.length]], undefined, `random ${trial}`);
  }
}, 120_000);

it('rejects impossible sizes like the original', async () => {
  for (const size of [[0, 200, 30], [132, NaN, 30], [132, 200, 0], [132, Infinity, 30], ['132', 200, 30]]) {
    let expected, actual;
    try { reference.createBookModel(books[0][0], books[0][1], ...size, null, {}); } catch (error) { expected = `${error.constructor.name}: ${error.message}`; }
    try { production.createBookModel(books[0][0], books[0][1], ...size, null, {}); } catch (error) { actual = `${error.constructor.name}: ${error.message}`; }
    expect(actual, String(size)).toBe(expected);
  }
});

it('runs the model methods with the same effects and results as the original', async () => {
  const page = (width, height, extra = {}) => {
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    return { source, width, height, toneKey:`tone-${width}`, text:'Page', ...extra };
  };
  for (const options of [{}, { shelf:true }, { shelf:true, overview:true }, { shelf:true, inspectionResolution:1024 }]) {
    for (const [book, style] of books) {
      await compare([book, style, 132, 200, 30, null, options], async (model, step) => {
        // Fresh sources for each module: the paper tone of a source is remembered across models.
        const shared = page(600, 900), stock = page(600, 900);
        step('open', model.userData.setCoverOpen(.5));
        step('pose', model.userData.setMotionPose(.8, .25));
        step('withdraw', model.userData.setBookmarkWithdraw(.6));
        step('theme before page', model.userData.setPageTheme(.3));
        step('snapshot', model.userData.setPageSnapshot({ ...shared, paper:stock }, { pageTheme:.2, redraw:false }));
        step('textures', model.userData.getPageTextures().length);
        step('theme', model.userData.setPageTheme(.7));
        step('same raster', model.userData.setPageSnapshot({ ...shared, paper:stock }));
        step('other size', model.userData.setPageSnapshot(page(500, 800, { paper:page(400, 800) }), { pageTheme:1 }));
        step('no source', model.userData.setPageSnapshot({ width:10, height:10 }));
        step('no size', model.userData.setPageSnapshot(page(0, 0)));
        step('theme value', model.userData.getPageTheme());
        step('spine', model.userData.updateSpineAppearance({ ...book, spineTitleOverride:'Other', spineFinish:'gold' }, { ...style, color:'#334455' }));
        step('cover finish', model.userData.updateCoverAppearance({ ...book, coverFinish:'glossy' }));
        step('cover relief off', model.userData.updateCoverAppearance({ ...book, coverRelief:null }));
        step('edges', model.userData.updateEdgeAppearance({ ...book, pageEdgeFinish:'glossy' }));
        step('bookmark', model.userData.updateBookmark({ ...book, progress:.9, locator:'x' }));
        step('no bookmark', model.userData.updateBookmark({ ...book, progress:0, locator:undefined }));
        step('bookmark again', model.userData.updateBookmark({ ...book, progress:.3, locator:'y' }));
        step('relief slots', model.userData.prepareCoverRelief());
        step('relief', model.userData.coverRelief());
        step('generated cover', model.userData.updateCoverSource(null, { ...book, title:'Renamed' }, style, { force:true }));
        step('image cover', model.userData.updateCoverSource('blob:wide-cover'));
        step('same image', model.userData.updateCoverSource('blob:wide-cover'));
        step('broken image', model.userData.updateCoverSource('blob:broken-cover'));
        step('loaded', model.userData.coverLoaded);
        step('dispose', model.userData.dispose());
        step('after dispose', [model.userData.setPageSnapshot(shared), model.userData.prepareCoverRelief(), model.userData.setPageTheme(.1)]);
        step('dispose twice', model.userData.dispose());
      }, `methods ${book.id} ${JSON.stringify(options)}`);
    }
  }
}, 120_000);

it('waits for a pending cover download and settles it like the original', async () => {
  for (const options of [{ shelf:true }, {}]) {
    for (const url of ['blob:cover', 'blob:wide', 'blob:broken']) {
      await compare([books[1][0], books[1][1], 140, 210, 26, url, options], async (model, step) => {
        const released = images.released;
        step('pending', [model.userData.coverLoaded, Boolean(model.getObjectByName('front-cover'))]);
        let settled = null; model.userData.ready.then(value => { settled = value; });
        for (const deliver of images.pending.splice(0)) deliver();
        await Promise.resolve(); await Promise.resolve();
        step('delivered', [settled, model.userData.coverLoaded]);
        step('source again', model.userData.updateCoverSource(url));
        step('forced', model.userData.updateCoverSource(url, undefined, undefined, { force:true }));
        for (const deliver of images.pending.splice(0)) deliver();
        await Promise.resolve();
        step('settled again', model.userData.coverLoaded);
        model.userData.dispose();
        step('released', images.released - released);
      }, `pending ${url} ${JSON.stringify(options)}`);
      images.mode = 'async';
    }
  }
}, 120_000);

it('holds no WebAssembly handle once a model is built and disposed', async () => {
  const { needRustShelf } = await import('../../src/js/rust-shelf.js');
  const shelf = needRustShelf();
  const live = () => shelf.shelf_live_handles?.() ?? null;
  // The first models intern their literals and fill the shared caches.
  for (let i = 0; i < 6; i++) production.createBookModel(books[i % 3][0], books[i % 3][1], 132, 200, 30, null, levels[i % levels.length]).userData.dispose();
  const before = live();
  for (let i = 0; i < 20; i++) production.createBookModel(books[i % 3][0], books[i % 3][1], 132, 200, 30, null, levels[i % levels.length]).userData.dispose();
  expect(live()).toBe(before);
});
