// Differential test: the native room's retained framebuffer cache, now rust-ui/src/native_room_cache.rs
// (native_room_cache_create) behind src/js/native-room-cache.js, against the frozen JavaScript
// (helpers/reference-native-room-cache.js). Both run the same seeded scripts of captures (valid, fractional,
// out of bounds, physical, with a render target bound), repaints, compositions of up to four layers (with
// clips, foreign or released textures, holes), slot releases, reference-aware pruning, exact/valid checks,
// program preparation, context loss and restoration, a lost or throwing context, dithering contexts and
// disposal, on the same recording renderer with the real three. Every renderer call with its arguments, the
// replay uniforms at each draw, the renderer state left behind, the textures' settings and every answer are
// compared. Also the idle uniform preparation, and a timing of capture + repaint.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import './helpers/rust-shelf-ready.js';
import { createNativeFramebufferCache } from '../../src/js/native-room-cache.js';
import { createNativeFramebufferCache as reference } from './helpers/reference-native-room-cache.js';

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function world(seed) {
  const pick = random(seed), log = [], ids = new Map();
  const id = value => {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (value.isVector2 || value.isVector4) return ['v', ...value.toArray()];
    if (value.isColor) return ['c', value.getHex(), value.r];
    if (!ids.has(value)) ids.set(value, `${value.type || value.constructor?.name || 'object'}#${ids.size}`);
    return ids.get(value);
  };
  const listeners = new Map();
  let ditherOn = pick() < 0.5;
  const gl = { DITHER:3024, isEnabled:() => { log.push(['isEnabled']); return ditherOn; },
    disable:value => { log.push(['disable', value]); ditherOn = false; }, enable:value => { log.push(['enable', value]); ditherOn = true; },
    flush:() => log.push(['flush']), isContextLost:() => false, drawingBufferWidth:780, drawingBufferHeight:1688 };
  const renderer = { domElement:{ width:780, height:1688 }, ratio:2, size:new THREE.Vector2(390, 844), autoClear:true,
    shadowMap:{ enabled:true }, target:null, scissor:new THREE.Vector4(1, 2, 3, 4), scissorTest:true, clearColor:new THREE.Color('#123456'), clearAlpha:0.7,
    contextMode:'gl', capabilities:pick() < 0.7 ? { maxTextureSize:4096 } : undefined,
    getContext() { log.push(['getContext', this.contextMode]); if (this.contextMode === 'throw') throw new Error('no context');
      if (this.contextMode === 'lost') return { isContextLost:() => true }; if (this.contextMode === 'plain') return {}; return gl; },
    copyFramebufferToTexture(texture, origin) { log.push(['copy', id(texture), id(origin), texture.image.width, texture.image.height]); },
    getRenderTarget() { return this.target; }, setRenderTarget(value) { log.push(['setRenderTarget', id(value)]); this.target = value; },
    getPixelRatio() { return this.ratio; }, setPixelRatio(value) { log.push(['setPixelRatio', value]); this.ratio = value; },
    getSize(value) { return value.copy(this.size); },
    setSize(width, height, style) { log.push(['setSize', width, height, style]); this.size.set(width, height); this.domElement.width = width * this.ratio; this.domElement.height = height * this.ratio; },
    setViewport(...args) { log.push(['setViewport', ...args]); },
    getScissor(value) { return value.copy(this.scissor); }, setScissor(value) { log.push(['setScissor', id(value)]); this.scissor.copy(value); },
    getScissorTest() { return this.scissorTest; }, setScissorTest(value) { log.push(['setScissorTest', value]); this.scissorTest = value; },
    getClearColor(value) { return value.copy(this.clearColor); }, getClearAlpha() { return this.clearAlpha; },
    setClearColor(value, alpha) { log.push(['setClearColor', id(value), alpha]); this.clearColor.set(value); this.clearAlpha = alpha; },
    clear(...args) { log.push(['clear', ...args, this.autoClear, this.shadowMap.enabled, ditherOn]); },
    render(scene, camera) {
      const material = scene.children[0].material, uniforms = material.uniforms;
      log.push(['render', id(scene), id(camera), scene.children.length, material.type, material.blending, material.depthTest, material.toneMapped,
        Object.entries(uniforms).map(([key, { value }]) => [key, id(value)])]);
    },
    compile(scene, camera) { log.push(['compile', id(scene), id(camera)]); } };
  renderer.domElement.addEventListener = (name, callback) => { log.push(['addEventListener', name]); listeners.set(name, callback); };
  renderer.domElement.removeEventListener = (name, callback) => { log.push(['removeEventListener', name, listeners.get(name) === callback]); if (listeners.get(name) === callback) listeners.delete(name); };
  return { pick, log, id, renderer, listeners };
}

const descriptors = [
  { width:120, height:200, ratio:2 }, { x:10, y:20, width:120, height:200, ratio:2, sourceX:20, sourceY:1248 },
  { width:390, height:844, ratio:2 }, { width:10.1, height:20, ratio:2 }, { width:10, height:20, ratio:2, x:NaN },
  { width:10, height:20, ratio:2, sourceX:-1 }, { width:500, height:20, ratio:2 }, { width:121, height:201, ratio:2 },
  { width:195.5, height:422, ratio:2, physical:true, pixelWidth:391, pixelHeight:844 }, { width:60, height:80, ratio:3, x:5, y:7, generation:0 },
  { width:60, height:80, ratio:3, generation:7 }, null
];

function script(create, seed) {
  const w = world(seed), { pick, log, id, renderer, listeners } = w;
  const answer = value => {
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'texture'
      ? [id(item), item.colorSpace, item.flipY, item.premultiplyAlpha, item.minFilter, item.magFilter, item.image.width, item.image.height] : item]));
  };
  const cache = create(renderer, { onRestored:() => log.push(['restored']) });
  const slots = [{}, {}, {}], frames = [];
  const frame = () => frames.length && pick() < 0.85 ? frames[Math.floor(pick() * frames.length)] : { width:120, height:200, ratio:2, texture:{} };
  for (let step = 0; step < 40; step++) {
    const roll = pick();
    let result;
    try {
      if (roll < 0.3) {
        const descriptor = descriptors[Math.floor(pick() * descriptors.length)];
        result = cache.capture(slots[Math.floor(pick() * slots.length)], descriptor && { ...descriptor });
        if (result) frames.push(result);
        result = answer(result);
      } else if (roll < 0.45) result = cache.repaint(frame());
      else if (roll < 0.6) {
        const count = Math.floor(pick() * 5), layers = [];
        for (let index = 0; index < count; index++) {
          const kind = pick();
          if (kind < 0.1) continue; // a hole
          layers[index] = kind < 0.2 ? null : { frame:frame(), x:Math.floor(pick() * 20) - 5, y:Math.floor(pick() * 20), scale:pick() < 0.8 ? 1 : 0.5,
            ...(pick() < 0.5 ? { clip:{ left:0, top:0, right:100 + Math.floor(pick() * 300), bottom:200 + Math.floor(pick() * 600) } } : {}) };
        }
        const output = pick() < 0.8 ? { x:pick() < 0.5 ? 0 : 3, y:0, width:390, height:844, ratio:2 } : { width:120.5, height:200, ratio:2 };
        result = cache.compose(output, pick() < 0.95 ? layers : 'not an array');
      } else if (roll < 0.66) cache.releaseSlot(slots[Math.floor(pick() * slots.length)]);
      else if (roll < 0.72) result = cache.releaseUnusedSlots(slots, frames.filter(() => pick() < 0.5));
      else if (roll < 0.77) result = [cache.exactFrame(frame()), cache.validFrame(frame()), cache.validFrame(null)];
      else if (roll < 0.8) cache.prepare();
      else if (roll < 0.84) listeners.get(pick() < 0.5 ? 'webglcontextlost' : 'webglcontextrestored')?.();
      else if (roll < 0.9) renderer.contextMode = ['gl', 'gl', 'plain', 'lost', 'throw'][Math.floor(pick() * 5)];
      else if (roll < 0.93) renderer.target = pick() < 0.5 ? {} : null;
      else if (roll < 0.95) cache.dispose();
      else result = cache.releaseUnusedSlots(new Set(slots), frames);
    } catch (error) { result = ['threw', error.constructor.name] }
    log.push(['answer', step, result]);
  }
  try { cache.dispose(); cache.dispose(); } catch (error) { log.push(['dispose threw', error.message]); }
  log.push(['state', renderer.autoClear, renderer.shadowMap.enabled, renderer.scissorTest, renderer.scissor.toArray(), renderer.clearColor.getHex(),
    renderer.clearAlpha, renderer.ratio, renderer.size.toArray(), [...listeners.keys()]]);
  return log;
}

describe('the native room framebuffer cache in Rust against the frozen JavaScript', () => {
  for (let seed = 1; seed <= 120; seed++) {
    it(`script ${seed}`, () => {
      const expected = script(reference, seed);
      const actual = script(createNativeFramebufferCache, seed);
      expect(actual).toEqual(expected);
      expect(expected.length).toBeGreaterThan(40);
    });
  }

  it('answers null for a renderer that cannot copy its framebuffer', () => {
    for (const renderer of [null, undefined, {}, { getContext() {} }, { copyFramebufferToTexture() {} }]) {
      expect(createNativeFramebufferCache(renderer)).toBe(reference(renderer));
    }
  });

  for (const variant of ['ready', 'no idle', 'disposed before idle', 'context lost before idle', 'not current', 'null options', 'idle throws']) {
    it(`prepares the replay program's uniforms in idle slices the same way (${variant})`, async () => {
      const run = async create => {
        const { log, renderer, id } = world(7);
        const program = { isReady:() => true, getUniforms:() => { log.push(['getUniforms']); return {}; } };
        const props = new WeakMap();
        renderer.compile = scene => { log.push(['compile', id(scene)]); scene.traverse(object => { if (object.material) props.set(object.material, { programs:new Map([['raw', program]]) }); }); };
        renderer.properties = { get:material => props.get(material) || {} };
        const cache = create(renderer);
        let calls = 0;
        const idle = async () => {
          calls++; log.push(['idle', calls]);
          if (variant === 'idle throws') throw new Error('idle failed');
          if (calls === 1 && variant === 'disposed before idle') cache.dispose();
          if (calls === 1 && variant === 'context lost before idle') renderer.contextMode = 'lost';
        };
        const options = variant === 'no idle' ? {} : variant === 'null options' ? null
          : variant === 'not current' ? { idle, current:() => 0 } : { idle };
        let answer;
        try { answer = await cache.prepareUniforms(options); } catch (error) { answer = ['rejected', error.constructor.name]; }
        log.push(['answer', answer]);
        return log;
      };
      expect(await run(createNativeFramebufferCache)).toEqual(await run(reference));
    });
  }

  it('times capture + repaint against the frozen JavaScript', () => {
    const timing = create => {
      const { renderer } = world(3);
      const cache = create(renderer), slot = {}, rounds = 2000;
      renderer.render = renderer.clear = renderer.setViewport = renderer.copyFramebufferToTexture = () => {};
      const frame = cache.capture(slot, { width:390, height:844, ratio:2 });
      for (let index = 0; index < 200; index++) cache.repaint(frame);
      const started = performance.now();
      for (let index = 0; index < rounds; index++) { cache.capture(slot, { width:390, height:844, ratio:2 }); cache.repaint(frame); }
      const elapsed = (performance.now() - started) / rounds;
      cache.dispose();
      return elapsed;
    };
    const js = Math.min(timing(reference), timing(reference)), rust = Math.min(timing(createNativeFramebufferCache), timing(createNativeFramebufferCache));
    console.log(`native room cache capture+repaint: JS ${(js * 1000).toFixed(1)} us, Rust ${(rust * 1000).toFixed(1)} us per pair`);
    expect(rust).toBeGreaterThan(0);
  });
});
