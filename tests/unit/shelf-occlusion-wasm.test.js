// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ core: null }));
vi.mock('../../src/js/rust-core.js', () => ({ getRustCore: () => state.core }));
import { createShelfOcclusion } from '../../src/js/shelf-furniture.js';
import { createShelfOcclusion as original } from './helpers/reference-shelf-furniture.js';
import { rustShelfOcclusion } from '../../src/js/shelf-occlusion-wasm.js';
let core;
beforeAll(async () => {
  core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
  expect(typeof core.shelf_occlusion).toBe('function'); state.core = core;
});
afterEach(() => { state.core = core; });
function exact(a, b) {
  expect(a).toBeDefined(); expect(a.index).toEqual(b.index);
  expect(Object.keys(a.attributes)).toEqual(Object.keys(b.attributes));
  for (const key of Object.keys(b.attributes)) {
    const left = a.attributes[key], right = b.attributes[key];
    expect(left.constructor).toBe(right.constructor); expect(left.itemSize).toBe(right.itemSize);
    const aBytes=Buffer.from(left.array.buffer,left.array.byteOffset,left.array.byteLength);
    const bBytes=Buffer.from(right.array.buffer,right.array.byteOffset,right.array.byteLength);
    // Compare every byte directly rather than deep-walking Buffer properties.
    // Keep the same coverage without spending seconds inside the assertion.
    expect(aBytes.equals(bBytes),`${key}: complete attribute bytes`).toBe(true);
  }
  expect(a.boundingBox).toEqual(b.boundingBox); expect(a.boundingSphere).toEqual(b.boundingSphere);
}
const base = { width:390, height:636, depth:155, rows:[{bottom:212},{bottom:424},{bottom:636}], floorY:-636 };
for (const count of [0, 1, 3, 8, 100]) it(`preserves all positions, RGBA and bounds for ${count} shelves`, () => {
  for (const scale of [undefined, .4, .65, 1, 1.3]) for (const floorLight of [null, [.5,.4,.29,.11]]) {
    const options = { ...base, rows:Array.from({length:count}, (_, i) => ({bottom:(i+1)*212})), scale, floorLight,
      footprints:[{x:280,z:-40,radius:30},{x:-235.7,z:10.2,radius:12.7}] };
    const call = vi.fn(core.shelf_occlusion); state.core = {...core, shelf_occlusion:call};
    const a = createShelfOcclusion(options), b = original(options);
    try { exact(a,b); expect(call).toHaveBeenCalledOnce(); } finally { a.dispose(); b.dispose(); }
  }
});
it('matches fractional geometry, malformed dimensions, duplicate rows and rejected footprints', () => {
  let seed = 17394;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; };
  for (let i=0;i<150;i++) {
    const bottom = random()*700;
    const options = { width:i%5===0?NaN:random()*1000+.001, height:random()*1200+.001,
      depth:i%7===0?-1:random()*200+.001, floorY:i%3===0?NaN:-random()*1000,
      rows:[{bottom},{bottom:0},{bottom},{bottom:NaN},{bottom:-20},{},{bottom:random()*900}],
      floorLight:i%2?[random(),random(),random(),random()]:['bad',0,0,1],
      footprints:[{x:random()*500,z:random()*100,radius:random()*20+.01},{x:0,z:0,radius:-1},{x:NaN,z:0,radius:10}] };
    const a = createShelfOcclusion(options), b = original(options);
    try { exact(a,b); } finally { a.dispose(); b.dispose(); }
  }
});
it('keeps owned attributes valid across arena reuse and memory growth', () => {
  const free = vi.fn(core.free_f64);
  state.core = {...core, free_f64:free, shelf_occlusion(...args) { core.memory.grow(1); return core.shelf_occlusion(...args); }};
  const a = createShelfOcclusion(base), saved = a.clone();
  const b = createShelfOcclusion({...base, floorLight:[.2,.3,.4,.1]}); core.memory.grow(1);
  try { exact(a,saved); expect(free).toHaveBeenCalledTimes(2); } finally { a.dispose(); b.dispose(); saved.dispose(); }
});
it('preserves the production fallback for absent, old, failed and corrupt cores', () => {
  for (const engine of [null, {}, {...core,alloc_f64:()=>0}, {...core,shelf_occlusion:()=>0},
    {...core,shelf_occlusion:()=>{throw Error('trap');}},
    {...core,shelf_occlusion(...args) { const n=core.shelf_occlusion(...args); new Float32Array(core.memory.buffer,args[4],1)[0]=NaN; return n; }}]) {
    const free=vi.fn(core.free_f64); state.core=engine?{...engine,free_f64:free}:null;
    const a=createShelfOcclusion(base), b=original(base);
    try { exact(a,b); if(engine?.shelf_occlusion&&engine.alloc_f64===core.alloc_f64)expect(free).toHaveBeenCalledOnce(); }
    finally { a.dispose(); b.dispose(); }
  }
});
it('rejects oversized allocations and malformed bridge parameters before allocating', () => {
  const allocate=vi.fn(core.alloc_f64); state.core={...core,alloc_f64:allocate};
  const frame={w:390,h:600,d:140,side:12,inner:366};
  for(const args of [[frame,new Array(1025).fill(1),0,[],null], [frame,[],0,new Array(1025).fill({}),null],
    [frame,[],NaN,[],null], [frame,[],0,null,null]]) expect(rustShelfOcclusion(...args)).toBeUndefined();
  expect(allocate).not.toHaveBeenCalled();
  expect(core.shelf_occlusion(0,1025,0,0,0)).toBe(0);
  expect(core.shelf_occlusion(0,0,1025,0,0)).toBe(0);
  expect(core.shelf_occlusion(0,0,0,2,0)).toBe(0);
});
