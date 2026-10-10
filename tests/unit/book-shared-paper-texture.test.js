import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createBookModel} from '../../src/js/book-model.js';
import {registerPageRaster} from '../../src/js/page-raster.js';
let model;
beforeEach(()=>{
 const context=new Proxy({measureText:text=>({width:String(text).length*16}),createLinearGradient:()=>({addColorStop(){}}),getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(object,key)=>object[key]??(()=>{})});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
 model=createBookModel({id:'shared-paper',title:'Original pages',format:'PDF'},
  {color:'#41695d',shade:'#2b463d',ink:'#fffaf0',coverRatio:1.5,width:35},180,120,35,null);
});
afterEach(()=>{model?.userData.dispose();vi.restoreAllMocks();});
function snapshot(shared=true){
 const source=document.createElement('canvas'),paper=document.createElement('canvas');source.width=paper.width=600;source.height=paper.height=400;
 const revision={};registerPageRaster(source,revision);registerPageRaster(paper,shared?revision:{});
 return{source,width:600,height:400,paper:{source:paper,width:600,height:400},text:'The actual restored page.',location:{locator:7}};
}
describe('one GPU texture for identical reader-owned page rasters',()=>{
 it('uses the same texture for both layers while keeping both real page meshes',()=>{
  const page=snapshot();expect(model.userData.setPageSnapshot(page,{pageTheme:0})).toBe(true);
  const front=model.getObjectByName('reading-page'),stock=model.getObjectByName('reading-page-stock');
  expect(front.visible).toBe(true);expect(stock.visible).toBe(true);expect(front.material.map).toBe(stock.material.map);
  expect(model.userData.getPageTextures()).toEqual([front.material.map]);expect(model.userData.pageSnapshot).toBe(page);
  model.userData.setPageTheme(.5);expect(front.material.opacity).toBe(.5);expect(front.material.map).toBe(stock.material.map);
 });
 it('keeps separate textures for different themes and original print colours',()=>{
  model.userData.setPageSnapshot(snapshot(false));
  expect(model.getObjectByName('reading-page').material.map).not.toBe(model.getObjectByName('reading-page-stock').material.map);
  expect(model.userData.getPageTextures()).toHaveLength(2);
 });
 it('retains the shared texture for fresh copies of the same exact raster',()=>{
  const first=snapshot();model.userData.setPageSnapshot(first);const texture=model.userData.getPageTextures()[0];
  const next=snapshot();const revision={};for(const page of [first,next]){registerPageRaster(page.source,revision);registerPageRaster(page.paper.source,revision);}
  model.userData.setPageSnapshot(first);const installed=model.userData.getPageTextures()[0];model.userData.setPageSnapshot(next);
  expect(model.userData.getPageTextures()).toEqual([installed]);expect(model.userData.pageSnapshot).toBe(next);expect(installed).not.toBe(texture);
 });
 it('releases the old shared texture on a changed page and retains a working replacement',()=>{
  model.userData.setPageSnapshot(snapshot());const old=model.userData.getPageTextures()[0],dispose=vi.spyOn(old,'dispose');
  model.userData.setPageSnapshot(snapshot(false));expect(dispose).toHaveBeenCalled();const textures=model.userData.getPageTextures();
  expect(textures).toHaveLength(2);expect(textures).not.toContain(old);textures.forEach(texture=>expect(texture.image.width).toBe(600));
 });
});
