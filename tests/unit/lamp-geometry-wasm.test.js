// @vitest-environment node
// The three shelf lamps as the Rust shelf module draws them, against the frozen three.js original: every mesh (name,
// order, flags), every geometry (attribute order and classes, bytes, index width, bounding box), the light emitter, the
// sizes and the ownership of what the host receives.
import {afterEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({loaded:true,calls:0}));
vi.mock('../../src/js/rust-shelf.js',async importOriginal=>{
 const actual=await importOriginal();
 const counted=new Proxy(actual.needRustShelf(),{get(target,name){
  if(name==='lamp_geometry')return(...args)=>{state.calls++;return target.lamp_geometry(...args);};
  return target[name];}});
 return{...actual,needRustShelf:()=>{if(!state.loaded)throw new Error('El módulo de la estantería no está cargado.');return counted;}};
});
import {createShelfLamp} from '../../src/js/shelf-lamps.js';
import {createShelfLamp as original} from './helpers/reference-shelf-lamps.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
afterEach(()=>{state.loaded=true;});
const meshes=group=>{const found=[];group.traverse(object=>{if(object.isMesh)found.push(object);});return found;};
function same(actual,expected,label){
 const a=meshes(actual),b=meshes(expected);
 expect(a.length,label).toBe(b.length);
 expect(actual.name).toBe(expected.name);
 expect(actual.children.map(child=>child.name),label).toEqual(expected.children.map(child=>child.name));
 for(let i=0;i<b.length;i++){
  const x=a[i].geometry,y=b[i].geometry,tag=`${label} ${b[i].name}`;
  expect(a[i].name,tag).toBe(b[i].name);expect(a[i].castShadow,tag).toBe(b[i].castShadow);expect(a[i].receiveShadow,tag).toBe(b[i].receiveShadow);expect(a[i].renderOrder,tag).toBe(b[i].renderOrder);
  expect(x.type,tag).toBe(y.type);
  expect(Object.keys(x.attributes),`${tag} attribute order`).toEqual(Object.keys(y.attributes));
  for(const name of Object.keys(y.attributes)){
   const l=x.attributes[name],r=y.attributes[name];
   expect(l.constructor,`${tag} ${name}`).toBe(r.constructor);expect(l.array.constructor,`${tag} ${name}`).toBe(r.array.constructor);
   expect(l.itemSize).toBe(r.itemSize);expect(l.normalized).toBe(r.normalized);expect(l.count,`${tag} ${name}`).toBe(r.count);
   if(!bytes(l.array).equals(bytes(r.array))){for(let k=0;k<l.array.length;k++)if(!Object.is(l.array[k],r.array[k]))throw Error(`${tag} ${name}[${k}] ${l.array[k]} / ${r.array[k]}`);}
  }
  if(y.index){
   expect(x.index.constructor,tag).toBe(y.index.constructor);expect(x.index.array.constructor,tag).toBe(y.index.array.constructor);expect(bytes(x.index.array).equals(bytes(y.index.array)),`${tag} index`).toBe(true);
  }else expect(x.index,tag).toBeNull();
  expect(x.boundingBox,`${tag} box`).toEqual(y.boundingBox);expect(x.boundingSphere,`${tag} sphere`).toEqual(y.boundingSphere);expect(x.groups).toEqual(y.groups);
  const m=a[i].material,n=b[i].material;
  for(const field of ['type','color','emissive','emissiveIntensity','roughness','metalness','bumpScale','clearcoat','clearcoatRoughness','side','transparent','opacity','depthWrite','vertexColors'])expect(m[field],`${tag} ${field}`).toEqual(n[field]);
 }
 const {setPower,setTint,setKelvin,dispose,...left}=actual.userData,{setPower:p,setTint:t,setKelvin:k,dispose:d,...right}=expected.userData;
 expect(left).toEqual(right);expect(Object.keys(left)).toEqual(Object.keys(right));expect(Object.keys(actual.userData.lightEmitter)).toEqual(Object.keys(expected.userData.lightEmitter));
}
describe('shelf lamps from the Rust shelf module',()=>{
 for(const lampId of ['mittled','tarnaby','tripod'])it(`${lampId} is the original lamp at every quality, size and temperature`,()=>{
  const cases=[{},{quality:'low'},{width:100},{height:150},{width:90,height:400},{width:400,height:90},{width:1},{width:5000},{width:NaN},{width:-5,height:0},{height:Infinity},{isOn:false,kelvin:2200},{kelvin:6500,quality:'low',width:130},{kelvin:'warm'},{lampId:'unknown'}];
  for(const options of cases){
   const a=createShelfLamp({lampId,...options}),b=original({lampId,...options});
   try{same(a,b,`${lampId} ${JSON.stringify(options)}`);
    a.userData.setPower(.4);b.userData.setPower(.4);a.userData.setKelvin(3000);b.userData.setKelvin(3000);
    expect(a.userData.lightEmitter).toEqual(b.userData.lightEmitter);
   }finally{a.dispose();b.dispose();}
  }
 });
 it('fits a lamp of any width and height to the same sizes as the original',()=>{
  let seed=7;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let trial=0;trial<30;trial++){
   const lampId=['mittled','tarnaby','tripod'][trial%3],options={lampId,quality:trial%2?'low':'high',width:random()*600+1,...(trial%3===1?{height:random()*500+1}:{})};
   const a=createShelfLamp(options),b=original(options);
   try{same(a,b,`random ${trial}`);}finally{a.dispose();b.dispose();}
  }
 });
 it('gives every lamp its own buffers: nothing aliases the module and editing one leaves the next intact',()=>{
  const a=createShelfLamp({lampId:'tripod'}),c=createShelfLamp({lampId:'tripod'});
  try{
   for(const mesh of meshes(a))for(const attribute of Object.values(mesh.geometry.attributes)){expect(attribute.array.buffer.byteLength).toBe(attribute.array.byteLength);}
   for(const mesh of meshes(a)){mesh.geometry.attributes.position.array.fill(7);mesh.geometry.index?.array.fill(1);}
   const b=createShelfLamp({lampId:'tripod'}),d=original({lampId:'tripod'});
   try{same(b,d,'after editing');same(c,d,'second lamp');}finally{b.dispose();d.dispose();}
  }finally{a.dispose();c.dispose();}
 });
 it('draws each lamp with one call of the module and keeps no handles or memory for repeated lamps',async()=>{
  const exports=await module.default();
  for(const lampId of ['mittled','tarnaby','tripod'])for(const quality of ['low','high']){const warm=createShelfLamp({lampId,quality});warm.dispose();}
  const before=state.calls,handles=module.shelf_live_handles(),capacity=exports.memory.buffer.byteLength;
  for(let i=0;i<30;i++){const lamp=createShelfLamp({lampId:['mittled','tarnaby','tripod'][i%3],quality:i%2?'low':'high'});lamp.dispose();}
  expect(state.calls-before).toBe(30);expect(module.shelf_live_handles()).toBe(handles);expect(exports.memory.buffer.byteLength).toBe(capacity);
 });
 it('reports a shelf module that is not loaded instead of working around it',()=>{
  state.loaded=false;
  for(const lampId of ['mittled','tarnaby','tripod'])expect(()=>createShelfLamp({lampId})).toThrow('El módulo de la estantería no está cargado.');
 });
 it('disposes its geometry once',()=>{
  const lamp=createShelfLamp({lampId:'tripod'}),spy=meshes(lamp).map(mesh=>vi.spyOn(mesh.geometry,'dispose'));
  lamp.dispose();lamp.dispose();lamp.userData.dispose();
  for(const s of spy)expect(s).toHaveBeenCalledTimes(1);
 });
});
