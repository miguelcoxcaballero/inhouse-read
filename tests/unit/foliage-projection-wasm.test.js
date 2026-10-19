import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {projectPlantFoliage} from '../../src/js/foliage-projection.js'
import {projectPlantFoliage as legacy} from '../../src/js/foliage-projection-legacy.js'
import {createShelfPlant} from '../../src/js/shelf-plants.js'
const runtime=vi.hoisted(()=>({ui:null,calls:0}));vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}));
// These cases isolate the historical UI/cold route. Shelf-only home readiness
// and the shared kernels are exercised separately in projection-runtime.test.js.
vi.mock('../../src/js/rust-shelf.js',async importOriginal=>({...await importOriginal(),getRustShelf:()=>null}));
let wasm;const native={...ui,foliage_path:(...args)=>{runtime.calls++;return ui.foliage_path(...args)}};
beforeAll(()=>{wasm=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})});beforeEach(()=>{runtime.ui=native;runtime.calls=0});
describe.each(['legacy','rust','late'])('native foliage pointer surface (%s)',mode=>{
 for(const id of ['monstera','sansevieria','chamaedorea','nephrolepis','zamioculcas','hedera','cactus','succulent'])it('preserves '+id+' at six real model poses',()=>{
  runtime.ui=mode==='rust'?native:null;const model=createShelfPlant({catalogId:id,potId:'gradvis',seed:'native-foliage-parity'});
  try{for(let i=0;i<6;i++){if(mode==='late'&&i===2)runtime.ui=native;model.position.set(i*3-7,i*5-3,0);model.rotation.set(i*.13,i*.2,i*.07);model.scale.set(i%2?-1:1,1.1,1);model.updateMatrixWorld(true);expect(projectPlantFoliage(model)).toEqual(legacy(model))}expect(runtime.calls>0).toBe(mode!=='legacy');expect(ui.ui_live_handles()).toBe(0)}finally{model.userData.dispose()}
 });
});
it('preserves nonindexed, empty indexed and excluded meshes',()=>{
 for(const indexed of ['yes','no','empty']){const geometry=new THREE.PlaneGeometry(10,10,4,4),mesh=new THREE.Mesh(indexed==='no'?geometry.toNonIndexed():geometry);mesh.name='leaf-batch';if(indexed==='empty')mesh.geometry.setIndex([]);mesh.updateMatrixWorld(true);expect(projectPlantFoliage(mesh)).toEqual(legacy(mesh));mesh.geometry.dispose()}
 const mesh=new THREE.Mesh(new THREE.BoxGeometry());mesh.name='ceramic-pot';expect(projectPlantFoliage(mesh)).toEqual({path:'',triangles:0});expect(runtime.calls).toBe(3);mesh.geometry.dispose();
});
it('preserves fallback for custom accessors, normalized and Float64 attributes',()=>{
 for(const kind of ['accessor','normalized','double']){const geometry=new THREE.PlaneGeometry(10,10),mesh=new THREE.Mesh(geometry);mesh.name='leaf-0';if(kind==='accessor')geometry.attributes.position.getX=function(index){return this.array[index*3]+2};if(kind==='normalized')geometry.attributes.position.normalized=true;if(kind==='double')geometry.setAttribute('position',new THREE.BufferAttribute(new Float64Array(geometry.attributes.position.array),3));mesh.updateMatrixWorld(true);expect(projectPlantFoliage(mesh)).toEqual(legacy(mesh));geometry.dispose()}expect(runtime.calls).toBe(0);
});
it('preserves fallback for failed, incomplete and malformed module results',()=>{
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10));mesh.name='leaf-0';mesh.updateMatrixWorld(true);for(const module of [{},{foliage_path:()=>{throw Error('Unavailable')}},{foliage_path:()=>new Float64Array([2,1])},{foliage_path:()=>['M0,0',-1]},{foliage_path:()=>[7,1]},{foliage_path:()=>['M0,0Z']},{foliage_path:()=>undefined}]){runtime.ui=module;expect(projectPlantFoliage(mesh)).toEqual(legacy(mesh))}mesh.geometry.dispose();
});
it('rejects malformed numeric packets without retaining native references',()=>{
 const matrix=new Float64Array(new THREE.Matrix4().elements),points=new Float32Array([0,0,0,10,0,0,0,10,0]);for(const [p,index,m,indexed] of [[new Float32Array(4),new Uint32Array(),matrix,false],[points,new Uint32Array([0,1,9]),matrix,true],[points,new Uint32Array(),new Float64Array(3),false],[new Float32Array([NaN,0,0]),new Uint32Array(),matrix,false]])expect(ui.foliage_path(p,index,m,indexed)).toBeUndefined();expect(ui.ui_live_handles()).toBe(0);
});
it('keeps memory stable through repeated complete pointer paths',()=>{
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(30,24,16));mesh.name='leaf-0';mesh.updateMatrixWorld(true);projectPlantFoliage(mesh);const capacity=wasm.memory.buffer.byteLength,retained=ui.ui_live_handles();for(let i=0;i<200;i++)projectPlantFoliage(mesh);expect(wasm.memory.buffer.byteLength).toBe(capacity);expect(ui.ui_live_handles()).toBe(retained);expect(runtime.calls).toBe(201);mesh.geometry.dispose();
});

// ---- the path text is now written in Rust: exact Number#toFixed(2) and exact meshes ----
const seeded=seed=>()=>{seed=Math.imul(seed^seed>>>15,1|seed)+0x6d2b79f5|0;seed^=seed+Math.imul(seed^seed>>>7,61|seed);return((seed^seed>>>14)>>>0)/4294967296}
function fixedCorpus(){
 const random=seeded(20261013),values=[0,-0,.005,-.005,.015,.025,.035,.045,.055,.065,.075,.085,.095,.125,.375,.625,.875,1.005,1.015,1.025,2.675,8.345,10.075,.994999999999,.9949999999999999,.995,.9950000000000001,99.995,-99.995,
  1e-7,-1e-7,1e-300,-1e-300,5e-324,-5e-324,2.2250738585072014e-308,.004999999999999999,.005000000000000001,.01,.1,.5,1,1.5,123456.785,-123456.785,4503599627370496.5,9007199254740991,-9007199254740991,
  1e15,1e15+.5,1e16,1e20,-1e20,99999999999999990000,123456789012345680000,999999999999999900000,1e21,-1e21,1e22,Infinity,-Infinity,NaN,Number.MAX_VALUE,Number.EPSILON,16777216,16777217,.30000000000000004]
 for(let k=-20000;k<=20000;k++){values.push(k/1000,k/200,k/8,k*.005,k*.0005,Math.fround(k/7),k/3)}
 for(let i=0;i<60000;i++){const magnitude=10**(random()*34-12);values.push((random()<.5?-1:1)*random()*magnitude)}
 for(let i=0;i<30000;i++)values.push(Math.round(random()*2e7-1e7)/200+((i&1)?1:-1)*2**-30*random())
 const view=new DataView(new ArrayBuffer(8));for(let i=0;i<30000;i++){view.setUint32(0,random()*4294967296>>>0);view.setUint32(4,random()*4294967296>>>0);values.push(view.getFloat64(0))}
 return values
}
const decimalCorpus=fixedCorpus()
let comparedDecimals=0
for(let start=0;start<decimalCorpus.length;start+=20_000)it(`writes exact decimal batch ${start/20_000+1}`,()=>{
 for(const value of decimalCorpus.slice(start,start+20_000)){
  const expected=Number.isFinite(value)&&Math.abs(value)<1e21?value.toFixed(2):undefined
  expect(ui.foliage_fixed(value)).toBe(expected);comparedDecimals++
 }
 expect(ui.ui_live_handles()).toBe(0)
})
it('compares the entire original decimal corpus',()=>{expect(comparedDecimals).toBe(decimalCorpus.length);expect(comparedDecimals).toBeGreaterThan(300000)})

function randomMesh(random,kind){
 const columns=2+Math.floor(random()*7),rows=2+Math.floor(random()*7),geometry=new THREE.PlaneGeometry(1+random()*80,1+random()*80,columns,rows)
 const position=geometry.attributes.position;for(let i=0;i<position.count;i++)position.setZ(i,(random()-.5)*40)
 const mesh=new THREE.Mesh(kind==='plain'?geometry.toNonIndexed():geometry);mesh.name=random()<.5?'leaf-batch':'cactus-batch'
 const scale=10**(random()*6-3);mesh.position.set((random()-.5)*10**(random()*9),(random()-.5)*10**(random()*9),(random()-.5)*50)
 mesh.rotation.set(random()*6.3,random()*6.3,random()*6.3);mesh.scale.set((random()<.2?-1:1)*scale,(random()<.2?-1:1)*scale*(.5+random()),scale);mesh.updateMatrixWorld(true);return mesh
}
it('writes the same path as the original projection for random meshes and extreme transforms',()=>{
 runtime.ui=native;const random=seeded(7);let triangles=0,declined=0
 for(let i=0;i<400;i++){
  const mesh=randomMesh(random,i%3===0?'plain':'indexed'),expected=legacy(mesh),before=runtime.calls
  const actual=projectPlantFoliage(mesh);expect(actual).toEqual(expected);expect(runtime.calls).toBe(before+1);triangles+=expected.triangles;if(!expected.triangles)declined++
  mesh.geometry.dispose()
 }
 expect(triangles).toBeGreaterThan(2000);expect(declined).toBeLessThan(200)
})
it('keeps the original path for a mesh whose coordinates leave the decimal range',()=>{
 runtime.ui=native;const geometry=new THREE.PlaneGeometry(10,10),mesh=new THREE.Mesh(geometry);mesh.name='leaf-0';mesh.position.set(5e20,-3e22,0);mesh.scale.set(1e19,1e19,1);mesh.updateMatrixWorld(true)
 const expected=legacy(mesh),actual=projectPlantFoliage(mesh);expect(actual).toEqual(expected);expect(expected.path).toContain('e+');geometry.dispose()
})
