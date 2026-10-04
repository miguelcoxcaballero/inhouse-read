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
    validFrame:frame=>Boolean(frame?.texture && !frame.texture.disposed),releaseSlot:vi.fn(),dispose:vi.fn()};
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

describe('native inspection copy-on-write and visible room presentation',()=>{
  it('captures a fitted fine and overview only once while keeping both exports lazy',()=>{
    fitted();driver.cache.capture.mockClear();view(1);
    expect(driver.cache.capture).toHaveBeenCalledTimes(1);
    const retained=driver.cache.capture.mock.results[0].value,{fine,overview}=outputs();
    expect(shelf.getNativeRoomBackground().frame).toBe(retained);
    expect(contexts.get(fine).copies).toHaveLength(0);expect(contexts.get(overview).copies).toHaveLength(0);
    fine.getContext('2d').getImageData();overview.getContext('2d').getImageData();
    expect(contexts.get(fine).frame).toEqual(retained.pixels);expect(contexts.get(overview).frame).toEqual(retained.pixels);
  });
  it('copies on write before a new fine and then reuses that separate slot without altering the old overview',()=>{
    fitted();const overviewFrame=shelf.getNativeRoomBackground().frame,oldPixels=structuredClone(overviewFrame.pixels);
    driver.cache.capture.mockClear();view(2);
    expect(driver.cache.capture).toHaveBeenCalledTimes(1);
    const fineFrame=shelf.getNativeRoomBackground().frame,slot=driver.cache.capture.mock.calls[0][0];
    expect(fineFrame.texture).not.toBe(overviewFrame.texture);expect(overviewFrame.texture.disposed).not.toBe(true);
    view(3,20,10);
    expect(driver.cache.capture).toHaveBeenCalledTimes(2);expect(driver.cache.capture.mock.calls[1][0]).toBe(slot);
    const {fine,overview}=outputs();fine.getContext('2d').getImageData();overview.getContext('2d').getImageData();
    expect(contexts.get(fine).frame).toEqual(shelf.getNativeRoomBackground().frame.pixels);
    expect(contexts.get(overview).frame).toEqual(oldPixels);expect(overviewFrame.pixels).toEqual(oldPixels);
  });
  it('refreshes the fitted overview from the same new fine and alternates at most two fine slots',()=>{
    fitted();driver.cache.capture.mockClear();view(2);view(1);view(2);view(1);
    expect(driver.cache.capture).toHaveBeenCalledTimes(4);
    const slots=driver.cache.capture.mock.calls.map(([slot])=>slot);
    expect(new Set(slots).size).toBe(2);expect(slots[0]).toBe(slots[1]);expect(slots[2]).toBe(slots[3]);expect(slots[0]).not.toBe(slots[2]);
    const frame=shelf.getNativeRoomBackground().frame,{fine,overview}=outputs();
    fine.getContext('2d').getImageData();overview.getContext('2d').getImageData();
    expect(contexts.get(fine).frame).toEqual(frame.pixels);expect(contexts.get(overview).frame).toEqual(frame.pixels);
  });
  it('preserves the retained overview when a legacy fallback clears the latest fine export',()=>{
    fitted();const original=shelf.getNativeRoomBackground().frame,oldPixels=structuredClone(original.pixels);
    driver.captureAllowed=false;view(2);expect(shelf.getNativeRoomBackground()).toBeNull();
    driver.captureAllowed=true;view(2);
    expect(shelf.getNativeRoomBackground().frame.texture).not.toBe(original.texture);
    outputs().overview.getContext('2d').getImageData();expect(contexts.get(outputs().overview).frame).toEqual(oldPixels);
    expect(original.texture.disposed).not.toBe(true);
  });
  it('presents only the visible viewport while retaining complete overscan and restores it after exports',()=>{
    fitted();const background=shelf.getNativeRoomBackground(),{fine,overview}=outputs();
    expect(background.frame.width).toBe(646);expect(background.frame.height).toBe(956);
    expect(background.x).toBe(-108);expect(background.y).toBe(-68);expect(background.clip).toEqual({left:20,top:60,right:410,bottom:760});
    expect(driver.renderer.domElement.width).toBe(585);expect(driver.renderer.domElement.height).toBe(1050);
    expect(driver.renderer.domElement.style.left).toBe('0px');expect(driver.renderer.domElement.style.top).toBe('0px');
    expect(driver.renderer.domElement.style.width).toBe('390px');expect(driver.renderer.domElement.style.height).toBe('700px');
    expect(fine.width).toBe(969);expect(fine.height).toBe(1434);expect(overview.width).toBe(969);expect(overview.height).toBe(1434);
    const visible=structuredClone(driver.renderer.domElement.frame);
    expect(visible.layers[0]).toEqual({pixels:background.frame.pixels,x:-128,y:-128,scale:1,clip:{left:0,top:0,right:390,bottom:700}});
    shelf.canvas.getContext('2d').getImageData();
    expect(contexts.get(shelf.canvas).copies.at(-1).args).toEqual([192,192,585,1050,0,0,585,1050]);
    expect(driver.renderer.domElement.frame).toEqual(visible);expect(driver.renderer.domElement.width).toBe(585);
    fine.getContext('2d').getImageData();overview.getContext('2d').getImageData();
    expect(driver.renderer.domElement.frame).toEqual(visible);expect(driver.renderer.domElement.height).toBe(1050);
    const foreign=document.createElement('canvas'),output=foreign.getContext('2d');
    withRendererPresentation(driver.renderer,null,()=>{driver.renderer.domElement.frame={foreign:true};output.drawImage(driver.renderer.domElement,0,0);});
    expect(output.frame).toEqual({foreign:true});expect(driver.renderer.domElement.frame).toEqual(visible);
  });
  it('keeps the original visible canvas fallback for fractional pixel bounds',()=>{
    vi.stubGlobal('devicePixelRatio',1.25);fitted();
    expect(shelf.getNativeRoomBackground()).toBeNull();expect(shelf.canvas.dataset.nativeRoomPresentation).toBe('false');
    expect(shelf.canvas.style.opacity).toBe('');expect(contexts.get(shelf.canvas).copies.length).toBeGreaterThan(0);
    const {fine,overview}=outputs();expect(fine.width).toBe(808);expect(overview.width).toBe(808);
  });
});
