import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { withRendererPresentation } from '../../src/js/native-renderer-presentation.js';

// Reusing a mock slot overwrites the same texture, just like the actual GPU
// cache. This catches an overview alias being overwritten by a later fine.
const driver=vi.hoisted(()=>({renderer:null,captureAllowed:true,frame:0,cache:null}));
vi.mock('../../src/js/book-model.js',async()=>{
  const Three=await import('three');let ratio=1;const size=new Three.Vector2();
  const renderer={domElement:document.createElement('canvas'),shadowMap:{},info:{render:{calls:0},memory:{},programs:[]},
    capabilities:{getMaxAnisotropy:()=>1},getPixelRatio:()=>ratio,setPixelRatio:value=>{ratio=value;},
    getSize:target=>target.copy(size),setViewport(){},setSize:(width,height)=>{size.set(width,height);renderer.domElement.width=width*ratio;renderer.domElement.height=height*ratio;},
    render:()=>{renderer.domElement.frame={scene:++driver.frame};renderer.info.render.calls++;}};
  driver.renderer=renderer;
  return {getBookRenderer:()=>renderer,lightBookScene(){},createBookModel(book,_style,width,height,thickness){
    const model=new Three.Group();model.name=`book:${book.id}`;
    model.add(new Three.Mesh(new Three.BoxGeometry(width,height,thickness),new Three.MeshStandardMaterial()));
    model.userData.dispose=()=>{};return model;
  }};
});
vi.mock('../../src/js/native-room-cache.js',()=>({createNativeFramebufferCache:renderer=>{
  const slots=new Map();
  const size=frame=>{renderer.setPixelRatio(frame.ratio);renderer.setSize(frame.width,frame.height,false);};
  const cache={capture:vi.fn((slot,frame)=>{
    if(!driver.captureAllowed || ![frame.width*frame.ratio,frame.height*frame.ratio].every(Number.isInteger))return null;
    let texture=slots.get(slot);
    if(!texture || texture.width!==frame.width*frame.ratio || texture.height!==frame.height*frame.ratio){
      if(texture)texture.disposed=true;
      texture={width:frame.width*frame.ratio,height:frame.height*frame.ratio};slots.set(slot,texture);
    }
    texture.pixels=structuredClone(renderer.domElement.frame);
    return {...frame,texture,get pixels(){return texture.pixels;}};
  }),prepare:vi.fn(),repaint:vi.fn(frame=>{size(frame);renderer.domElement.frame=structuredClone(frame.texture.pixels);return true;}),
    compose:vi.fn((output,layers)=>{size(output);renderer.domElement.frame={layers:layers.map(layer=>({pixels:structuredClone(layer.frame.texture.pixels),x:layer.x,y:layer.y,scale:layer.scale,clip:layer.clip}))};return true;}),
    validFrame:frame=>Boolean(frame?.texture && !frame.texture.disposed),
    releaseSlot:vi.fn(slot=>{const texture=slots.get(slot);if(texture){texture.disposed=true;slots.delete(slot);}}),
    releaseUnusedSlots:vi.fn((managed,retained)=>{
      const keep=new Set(retained.filter(frame=>cache.validFrame(frame)).map(frame=>frame.texture));let count=0;
      for(const slot of managed){const texture=slots.get(slot);if(texture && !keep.has(texture)){cache.releaseSlot(slot);count++;}}
      return count;
    }),dispose:vi.fn()};
  driver.cache=cache;return cache;
}}));

let shelf,stage,scroller,contexts,frames;
class Context {
  constructor(canvas){this.canvas=canvas;this.copies=[];this.frame=null;}
  clearRect(){this.frame=null;}
  drawImage(source,...args){this.frame=structuredClone(source.frame||contexts.get(source)?.frame||null);this.copies.push({source,args});}
  getImageData(){return {frame:structuredClone(this.frame),data:new Uint8ClampedArray(4)};}
  createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4)};}
  putImageData(){}
}
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
const outputs=()=>({fine:stage.querySelector('.ihr-bookshelf-inspection-snapshot'),overview:stage.querySelector('.ihr-bookshelf-inspection-overview')});
const fitted=()=>{shelf.setMode('isometric',{animate:false});shelf.flush();};
const view=(zoom,panX=0,panY=0)=>shelf.setInspectionView({zoom,panX,panY},{moving:false,renderNow:true});
beforeEach(()=>{
  driver.captureAllowed=true;driver.frame=0;contexts=new WeakMap();frames=new Map();
  class TestContext extends Context {drawImage(...args){return super.drawImage(...args);}getImageData(...args){return super.getImageData(...args);}}
  vi.stubGlobal('CanvasRenderingContext2D',TestContext);vi.stubGlobal('devicePixelRatio',2);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){
    if(kind!=='2d')return null;if(!contexts.has(this))contexts.set(this,new TestContext(this));return contexts.get(this);
  });
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
  let serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));vi.spyOn(performance,'now').mockReturnValue(0);
  window.matchMedia=()=>({matches:false});
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:700});scroller.getBoundingClientRect=()=>rect(20,60,390,700);
  stage.getBoundingClientRect=()=>rect(20,60,390,750);
  shelf=createBookshelfScene({stage,scroller,width:390,height:750,rows:[{top:20,bottom:220}],entries:[]});
  shelf.canvas.getBoundingClientRect=()=>rect(20,60,390,700);shelf.flush();
});
afterEach(()=>{shelf?.dispose();shelf=null;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});


describe('scene pruning preserves actual presentation and lazy export references',()=>{
  it('releases an abandoned frontal texture only after the native fitted room has replaced it',()=>{
    const old=shelf.getNativeRoomBackground().frame;
    fitted();const current=shelf.getNativeRoomBackground().frame;
    expect(driver.cache.validFrame(old)).toBe(false);expect(driver.cache.validFrame(current)).toBe(true);
    expect(driver.cache.releaseUnusedSlots).toHaveBeenCalled();
    const [,retained]=driver.cache.releaseUnusedSlots.mock.calls.at(-1);
    expect(retained.filter(frame=>frame?.texture===current.texture)).toHaveLength(6);
    expect(shelf.getNativeRoomBackground().lease.isOwner()).toBe(true);
    expect(contexts.get(shelf.canvas).copies).toHaveLength(0);
  });
  it('retains separate overview and fine textures for their lazy exports after a zoomed room paint',()=>{
    fitted();const overviewFrame=shelf.getNativeRoomBackground().frame,oldPixels=structuredClone(overviewFrame.pixels);
    view(2);const fineFrame=shelf.getNativeRoomBackground().frame;
    expect(fineFrame.texture).not.toBe(overviewFrame.texture);
    for(const frame of [fineFrame,overviewFrame])expect(driver.cache.validFrame(frame)).toBe(true);
    const [,retained]=driver.cache.releaseUnusedSlots.mock.calls.at(-1);
    expect(retained.some(frame=>frame?.texture===fineFrame.texture)).toBe(true);
    expect(retained.some(frame=>frame?.texture===overviewFrame.texture)).toBe(true);
    const {fine,overview}=outputs();expect(contexts.get(fine).copies).toHaveLength(0);expect(contexts.get(overview).copies).toHaveLength(0);
    overview.getContext('2d').getImageData();expect(contexts.get(overview).frame).toEqual(oldPixels);
    expect(shelf.getNativeRoomBackground().lease.isOwner()).toBe(true);
  });
  it('keeps hidden or frontal lazy export textures until an actual consumer requests their bytes',()=>{
    fitted();const overviewFrame=shelf.getNativeRoomBackground().frame;view(2);
    const fineFrame=shelf.getNativeRoomBackground().frame,{fine,overview}=outputs();
    const expectedFine=structuredClone(fineFrame.pixels),expectedOverview=structuredClone(overviewFrame.pixels);
    shelf.setMode('spine',{animate:false});shelf.flush();shelf.setPresentationActive(false);
    for(const frame of [fineFrame,overviewFrame])expect(driver.cache.validFrame(frame)).toBe(true);
    expect(contexts.get(fine).copies).toHaveLength(0);expect(contexts.get(overview).copies).toHaveLength(0);
    fine.getContext('2d').getImageData();overview.getContext('2d').getImageData();
    expect(contexts.get(fine).frame).toEqual(expectedFine);expect(contexts.get(overview).frame).toEqual(expectedOverview);
  });
});
