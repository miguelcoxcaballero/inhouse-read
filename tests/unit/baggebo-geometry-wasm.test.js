// @vitest-environment node
// The whole BAGGEBO as the Rust shelf module draws it, against the frozen three.js original: every part
// (name, bounds, metadata), every merged batch (attribute order, stored types, bytes, index width, bounding box and
// sphere), the materials, the paint grain, and the ownership of what the host receives.
import {afterEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({loaded:true,templates:0,textures:0}));
vi.mock('../../src/js/rust-shelf.js',async importOriginal=>{
 const actual=await importOriginal();
 const counted=new Proxy(actual.needRustShelf(),{get(target,name){
  if(name==='baggebo_template')return(...args)=>{state.templates++;return target.baggebo_template(...args);};
  if(name==='baggebo_paint_texture')return(...args)=>{state.textures++;return target.baggebo_paint_texture(...args);};
  return target[name];}});
 return{...actual,needRustShelf:()=>{if(!state.loaded)throw new Error('El módulo de la estantería no está cargado.');return counted;}};
});
import {createBaggebo} from '../../src/js/baggebo-model.js';
import {createBaggebo as original} from './helpers/reference-baggebo-model.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
afterEach(()=>{state.loaded=true;});
function same(actual,expected){
 expect(actual.children.length).toBe(expected.children.length);
 expect(actual.userData.parts).toEqual(expected.userData.parts);
 expect(actual.userData.shelfPositions).toEqual(expected.userData.shelfPositions);expect(actual.userData.physicalDimensions).toEqual(expected.userData.physicalDimensions);
 expect(actual.scale).toEqual(expected.scale);expect(actual.name).toBe(expected.name);expect(Object.keys(actual.userData)).toEqual(Object.keys(expected.userData));
 for(let i=0;i<expected.children.length;i++){
  const a=actual.children[i],b=expected.children[i],x=a.geometry,y=b.geometry;
  expect(a.material.name).toBe(b.material.name);expect(a.material.type).toBe(b.material.type);expect(a.castShadow).toBe(b.castShadow);expect(a.receiveShadow).toBe(b.receiveShadow);
  expect(Object.keys(x.attributes)).toEqual(Object.keys(y.attributes));
  for(const name of Object.keys(y.attributes)){
   const l=x.attributes[name],r=y.attributes[name];
   expect(l.constructor,name).toBe(r.constructor);expect(l.array.constructor,name).toBe(r.array.constructor);expect(l.itemSize,name).toBe(r.itemSize);expect(l.normalized,name).toBe(r.normalized);
   expect(l.count,name).toBe(r.count);expect(bytes(l.array).equals(bytes(r.array)),`${i}/${name} bytes`).toBe(true);
  }
  expect(x.index.constructor).toBe(y.index.constructor);expect(x.index.array.constructor).toBe(y.index.array.constructor);expect(bytes(x.index.array).equals(bytes(y.index.array))).toBe(true);
  expect(x.boundingBox).toEqual(y.boundingBox);expect(x.boundingSphere).toEqual(y.boundingSphere);expect(x.groups).toEqual(y.groups);expect(x.userData).toEqual(y.userData);
  for(const field of ['color','roughness','metalness','bumpScale','clearcoat','clearcoatRoughness','side','vertexColors'])expect(a.material[field],`${b.material.name} ${field}`).toEqual(b.material[field]);
  if(!b.material.bumpMap){expect(a.material.bumpMap).toBeFalsy();continue;}
  expect(a.material.bumpMap.name).toBe(b.material.bumpMap.name);expect(bytes(a.material.bumpMap.image.data).equals(bytes(b.material.bumpMap.image.data)),'paint grain').toBe(true);
  for(const field of ['wrapS','wrapT','magFilter','minFilter','generateMipmaps','colorSpace'])expect(a.material.bumpMap[field],field).toBe(b.material.bumpMap[field]);
 }
}
describe('BAGGEBO from the Rust shelf module',()=>{
 it('is the original model at every width',()=>{
  for(const width of [600,390,280,1,undefined,NaN,-5,0]){
   const a=createBaggebo(width===undefined?{}:{width}),b=original(width===undefined?{}:{width});
   try{same(a,b);}finally{a.userData.dispose();b.userData.dispose();}
  }
 });
 it('builds the template once and gives every model its own copy of the buffers',()=>{
  const before=state.templates,a=createBaggebo(),b=createBaggebo();
  try{
   expect(state.templates-before).toBeLessThanOrEqual(1);
   for(let i=0;i<a.children.length;i++)for(const name of Object.keys(a.children[i].geometry.attributes)){
    const x=a.children[i].geometry.attributes[name].array,y=b.children[i].geometry.attributes[name].array;
    expect(x.buffer).not.toBe(y.buffer);expect(x.buffer.byteLength).toBe(x.byteLength);
   }
   a.children[0].geometry.attributes.position.array.fill(7);a.children[0].geometry.index.array.fill(1);
   const c=createBaggebo();try{same(c,b);}finally{c.userData.dispose();}
  }finally{a.userData.dispose();b.userData.dispose();}
 });
 it('owns its parts: editing one model leaves the next one intact',()=>{
  const a=createBaggebo();a.userData.parts[0].bounds.min.set(9,9,9);a.userData.parts[0].name='changed';a.userData.dispose();
  const b=createBaggebo(),c=original();try{same(b,c);}finally{b.userData.dispose();c.userData.dispose();}
 });
 it('reports a shelf module that is not loaded instead of working around it',()=>{
  state.loaded=false;
  // the template is cached after the first build, the paint grain is not: building still needs the module
  expect(()=>createBaggebo()).toThrow('El módulo de la estantería no está cargado.');
 });
 it('leaves no handles or memory behind for repeated models',()=>{
  const warm=createBaggebo();warm.userData.dispose();
  const handles=module.shelf_live_handles();
  for(let i=0;i<30;i++){const model=createBaggebo();model.userData.dispose();}
  expect(module.shelf_live_handles()).toBe(handles);
 });
 it('disposes its geometry, materials and grain once',()=>{
  const model=createBaggebo(),geometries=model.children.map(mesh=>mesh.geometry),spy=geometries.map(g=>vi.spyOn(g,'dispose'));
  model.userData.dispose();model.userData.dispose();model.userData.disposeGeometry();
  for(const s of spy)expect(s).toHaveBeenCalledTimes(1);
 });
});
