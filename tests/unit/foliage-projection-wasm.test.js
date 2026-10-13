import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {projectPlantFoliage} from '../../src/js/foliage-projection.js'
import {projectPlantFoliage as legacy} from '../../src/js/foliage-projection-legacy.js'
import {createShelfPlant} from '../../src/js/shelf-plants.js'
const runtime=vi.hoisted(()=>({ui:null,calls:0}));vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}));
let wasm;const native={...ui,foliage_plan:(...args)=>{runtime.calls++;return ui.foliage_plan(...args)}};
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
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,10));mesh.name='leaf-0';mesh.updateMatrixWorld(true);for(const module of [{},{foliage_plan:()=>{throw Error('Unavailable')}},{foliage_plan:()=>new Float64Array([2,1])}]){runtime.ui=module;expect(projectPlantFoliage(mesh)).toEqual(legacy(mesh))}mesh.geometry.dispose();
});
it('rejects malformed numeric packets without retaining native references',()=>{
 const matrix=new Float64Array(new THREE.Matrix4().elements),points=new Float32Array([0,0,0,10,0,0,0,10,0]);for(const [p,index,m,indexed] of [[new Float32Array(4),new Uint32Array(),matrix,false],[points,new Uint32Array([0,1,9]),matrix,true],[points,new Uint32Array(),new Float64Array(3),false],[new Float32Array([NaN,0,0]),new Uint32Array(),matrix,false]])expect(ui.foliage_plan(p,index,m,indexed)).toBeUndefined();expect(ui.ui_live_handles()).toBe(0);
});
it('keeps memory stable through repeated complete pointer paths',()=>{
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(30,24,16));mesh.name='leaf-0';mesh.updateMatrixWorld(true);projectPlantFoliage(mesh);const capacity=wasm.memory.buffer.byteLength,retained=ui.ui_live_handles();for(let i=0;i<200;i++)projectPlantFoliage(mesh);expect(wasm.memory.buffer.byteLength).toBe(capacity);expect(ui.ui_live_handles()).toBe(retained);expect(runtime.calls).toBe(201);mesh.geometry.dispose();
});
