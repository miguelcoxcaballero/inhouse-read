import {describe,it,expect,vi,afterEach} from 'vitest';
import {createBookModel} from '../../src/js/book-model.js';
const book={id:'ribbon-reuse',title:'A printed cover',author:'An author',format:'EPUB'};
const style={color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40};
const models=[];
afterEach(()=>{for(const model of models.splice(0))model.userData.dispose();vi.restoreAllMocks();});
function make(progress,options={}){
 if(!HTMLCanvasElement.prototype.getContext.mock){
  const context=new Proxy({measureText:text=>({width:String(text).length*16}),createLinearGradient:()=>({addColorStop(){}}),getImageData:(_x,_y,width,height)=>({data:new Uint8ClampedArray(width*height*4)})},{get:(target,key)=>target[key]??(()=>{})});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
 }
 const model=createBookModel({...book,progressFraction:progress},style,132,200,40,null,options);models.push(model);return model;
}
const ribbon=model=>model.getObjectByName('reading-bookmark');
function equalRibbon(a,b){
 for(const name of ['position','normal','uv'])expect(a.geometry.attributes[name].array).toEqual(b.geometry.attributes[name].array);
 expect(a.geometry.index.array).toEqual(b.geometry.index.array);
 for(const name of ['color','sheenColor'])expect(a.material[name].toArray()).toEqual(b.material[name].toArray());
 for(const name of ['metalness','roughness','sheen','sheenRoughness','anisotropy','alphaTest','side','specularIntensity'])expect(a.material[name]).toBe(b.material[name]);
 expect(a.visible).toBe(b.visible);
}
describe('bookmark progress keeps the existing GPU resources',()=>{
 it('keeps the same mesh, material, alpha map and buffers through repeated saves',()=>{
  const model=make(.2),before=ribbon(model),geometry=before.geometry,material=before.material,map=material.alphaMap;
  const position=geometry.attributes.position.array,index=geometry.index.array,version=material.version;
  const releaseGeometry=vi.spyOn(geometry,'dispose'),releaseMaterial=vi.spyOn(material,'dispose'),releaseMap=vi.spyOn(map,'dispose');
  for(const progress of [.21,.3,.55,.6,.85,.9])model.userData.updateBookmark({...book,progressFraction:progress});
  const after=ribbon(model);expect(after).toBe(before);expect(after.geometry).toBe(geometry);expect(after.material).toBe(material);expect(after.material.alphaMap).toBe(map);
  expect(after.geometry.attributes.position.array).toBe(position);expect(after.geometry.index.array).toBe(index);expect(material.version).toBe(version);
  expect(releaseGeometry).not.toHaveBeenCalled();expect(releaseMaterial).not.toHaveBeenCalled();expect(releaseMap).not.toHaveBeenCalled();
 });
 it('matches fresh geometry and silk at every shelf detail level',()=>{
  for(const options of [{shelf:true,overview:true},{shelf:true},{shelf:true,inspectionResolution:1024},{}]){
   const updated=make(.2,options);updated.userData.updateBookmark({...book,progressFraction:.77});
   equalRibbon(ribbon(updated),ribbon(make(.77,options)));
  }
 });
 it('keeps the material when completing and returning to an unfinished page',()=>{
  const model=make(.2),mesh=ribbon(model),material=mesh.material,version=material.version;
  for(const progress of [1,.63,1,.3]){
   model.userData.updateBookmark({...book,progressFraction:progress});
   expect(ribbon(model)).toBe(mesh);expect(mesh.material).toBe(material);expect(material.version).toBe(version);
   equalRibbon(mesh,ribbon(make(progress)));
  }
 });
 it('preserves the current opening and withdrawal pose while saving progress',()=>{
  const updated=make(.2);updated.userData.setCoverOpen(.6);updated.userData.setBookmarkWithdraw(.25);
  updated.userData.updateBookmark({...book,progressFraction:.79});
  const fresh=make(.79);fresh.userData.setCoverOpen(.6);fresh.userData.setBookmarkWithdraw(.25);
  equalRibbon(ribbon(updated),ribbon(fresh));
 });
 it('releases resources once on removal and creates a correct first bookmark later',()=>{
  const model=make(.2),old=ribbon(model),releaseGeometry=vi.spyOn(old.geometry,'dispose'),releaseMaterial=vi.spyOn(old.material,'dispose'),releaseMap=vi.spyOn(old.material.alphaMap,'dispose');
  model.userData.updateBookmark({...book,progressFraction:0});expect(ribbon(model)).toBeUndefined();expect(model.userData.hasBookmark).toBe(false);
  expect(releaseGeometry).toHaveBeenCalledOnce();expect(releaseMaterial).toHaveBeenCalledOnce();expect(releaseMap).toHaveBeenCalledOnce();
  model.userData.updateBookmark({...book,progressFraction:.3});expect(ribbon(model)).not.toBe(old);equalRibbon(ribbon(model),ribbon(make(.3)));
  model.userData.dispose();expect(releaseGeometry).toHaveBeenCalledOnce();expect(releaseMaterial).toHaveBeenCalledOnce();expect(releaseMap).toHaveBeenCalledOnce();
 });
 it('does not recreate a ribbon for an unread or disposed book',()=>{
  const model=make(0);model.userData.updateBookmark({...book,progressFraction:0});expect(ribbon(model)).toBeUndefined();
  model.userData.updateBookmark({...book,progressFraction:.2});expect(model.userData.hasBookmark).toBe(true);
  model.userData.dispose();const old=ribbon(model);model.userData.updateBookmark({...book,progressFraction:.6});expect(ribbon(model)).toBe(old);
 });
});
