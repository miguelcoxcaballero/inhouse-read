import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { withRendererPresentation } from '../../src/js/native-renderer-presentation.js';

// Only the driver/cache pixels are faked. The actual shelf scheduling, lazy
// exports, native lease and fallback visibility run without a WebGL context.
const driver=vi.hoisted(()=>({renderer:null,captureAllowed:true,frame:0,cache:null,onRestored:null}));
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
vi.mock('../../src/js/native-room-cache.js',()=>({createNativeFramebufferCache:(renderer,{onRestored})=>{
  driver.onRestored=onRestored;
  const cache={capture:vi.fn((_slot,frame)=>driver.captureAllowed?{...frame,texture:{},pixels:structuredClone(renderer.domElement.frame)}:null),
    prepare:vi.fn(),repaint:vi.fn(frame=>{renderer.domElement.frame=structuredClone(frame.pixels);return true;}),
    compose:vi.fn((_output,layers)=>{renderer.domElement.frame={layers:layers.map(layer=>structuredClone(layer.frame.pixels))};return true;}),
    validFrame:frame=>Boolean(frame?.texture),releaseSlot:vi.fn(),dispose:vi.fn()};driver.cache=cache;return cache;
}}));

let shelf,stage,scroller,contexts,frames,clock;
class Context {
  constructor(canvas){this.canvas=canvas;this.copies=[];this.frame=null;}
  clearRect(){this.frame=null;}
  drawImage(source,...args){this.frame=structuredClone(source.frame||contexts.get(source)?.frame||null);this.copies.push({source,args});}
  getImageData(){return {frame:structuredClone(this.frame),data:new Uint8ClampedArray(4)};}
  createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4)};}
  putImageData(){}
}
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
beforeEach(()=>{
  driver.captureAllowed=true;driver.frame=0;contexts=new WeakMap();frames=new Map();clock=0;
  class TestContext extends Context {drawImage(...args){return super.drawImage(...args);}getImageData(...args){return super.getImageData(...args);}}
  vi.stubGlobal('CanvasRenderingContext2D',TestContext);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){
    if(kind!=='2d')return null;if(!contexts.has(this))contexts.set(this,new TestContext(this));return contexts.get(this);
  });
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
  let serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));vi.spyOn(performance,'now').mockImplementation(()=>clock);
  window.matchMedia=()=>({matches:false});
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:700});scroller.getBoundingClientRect=()=>rect(20,60,390,700);
  stage.getBoundingClientRect=()=>rect(20,60,390,750);
  shelf=createBookshelfScene({stage,scroller,width:390,height:750,rows:[{top:20,bottom:220}],entries:[]});
  shelf.canvas.getBoundingClientRect=()=>rect(20,60,390,700);
  shelf.flush();
});
afterEach(()=>{shelf?.dispose();shelf=null;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('native room presentation and lazy exports',()=>{
  it('presents the original resolved room without eagerly copying its pixels',()=>{
    expect(shelf.getNativeRoomBackground()?.lease.isOwner()).toBe(true);
    expect(shelf.canvas.style.opacity).toBe('0');
    expect(contexts.get(shelf.canvas).copies).toHaveLength(0);
    const frame=shelf.getNativeRoomBackground();
    expect(frame.clip).toEqual({left:20,top:60,right:410,bottom:760});
    expect(driver.renderer.domElement.parentElement.className).toBe('ihr-bookshelf-native-room-clip');
  });
  it('exports the retained base only when requested and restores the native owner',()=>{
    const background=shelf.getNativeRoomBackground(),pixels=structuredClone(background.frame.pixels);
    shelf.canvas.getContext('2d').getImageData(0,0,1,1);
    expect(contexts.get(shelf.canvas).frame).toEqual(pixels);
    expect(contexts.get(shelf.canvas).copies).toHaveLength(1);
    expect(driver.renderer.domElement.frame).toEqual(pixels);
    shelf.canvas.getContext('2d').getImageData(0,0,1,1);
    expect(contexts.get(shelf.canvas).copies).toHaveLength(1);
  });
  it('finishes a foreign export before restoring the actual room frame',()=>{
    const expected=structuredClone(shelf.getNativeRoomBackground().frame.pixels),foreign=document.createElement('canvas');
    const output=foreign.getContext('2d');
    withRendererPresentation(driver.renderer,null,()=>{
      driver.renderer.domElement.frame={foreign:true};output.drawImage(driver.renderer.domElement,0,0);
    });
    expect(output.frame).toEqual({foreign:true});expect(driver.renderer.domElement.frame).toEqual(expected);
  });
  it('makes a newly painted legacy fallback visible after releasing the native room',()=>{
    expect(shelf.canvas.style.opacity).toBe('0');driver.captureAllowed=false;
    shelf.invalidate();shelf.flush();
    expect(shelf.canvas.dataset.nativeRoomPresentation).toBe('false');
    expect(shelf.canvas.style.opacity).toBe('');
    expect(contexts.get(shelf.canvas).copies).toHaveLength(1);
    expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(shelf.getNativeRoomBackground()).toBeNull();
  });
  it('materializes unchanged fine and overview once and uses the original CSS transform during inspection',()=>{
    shelf.setMode('isometric',{animate:false});shelf.flush();
    const fine=stage.querySelector('.ihr-bookshelf-inspection-snapshot'),overview=stage.querySelector('.ihr-bookshelf-inspection-overview');
    const renders=shelf.canvas.dataset.snapshotRenderCount,pixels=structuredClone(shelf.getNativeRoomBackground().frame.pixels);
    expect(contexts.get(fine).copies).toHaveLength(0);expect(contexts.get(overview).copies).toHaveLength(0);
    driver.cache.capture.mockClear();
    shelf.setInspectionView({zoom:1.1,panX:0,panY:0},{moving:true,renderNow:true});
    expect(shelf.canvas.dataset.snapshotRenderCount).toBe(renders);expect(shelf.canvas.dataset.inspectionCacheActive).toBe('true');
    expect(driver.cache.capture).not.toHaveBeenCalled();
    expect(contexts.get(fine).copies).toHaveLength(1);expect(contexts.get(overview).copies).toHaveLength(1);
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual(pixels);
    const view=shelf.getInspectionView(),left=view.width/2-1.1*(view.width/2)-128*1.1,top=view.height/2-1.1*(view.height/2)-128*1.1;
    expect(fine.style.transform).toBe(`matrix(1.1,0,0,1.1,${left},${top})`);expect(overview.style.transform).toBe(fine.style.transform);
    expect(fine.style.display).toBe('block');expect(overview.style.display).toBe('block');expect(driver.renderer.domElement.isConnected).toBe(false);
    shelf.setInspectionView({zoom:1.2,panX:10,panY:0},{moving:true,renderNow:true});
    fine.getContext('2d').getImageData(0,0,1,1);overview.getContext('2d').getImageData(0,0,1,1);
    expect(contexts.get(fine).copies).toHaveLength(1);expect(contexts.get(overview).copies).toHaveLength(1);
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual(pixels);expect(driver.cache.capture).not.toHaveBeenCalled();
  });
  it('forces the original scene redraw on context restoration even while presentation is hidden',()=>{
    shelf.setPresentationActive(false);const renders=Number(shelf.canvas.dataset.snapshotRenderCount);
    driver.onRestored();
    expect(Number(shelf.canvas.dataset.snapshotRenderCount)).toBe(renders+1);
    expect(shelf.canvas.dataset.inspectionDirtySource).toBe('context-restored');
    expect(shelf.getNativeRoomBackground()?.lease.isOwner()).toBe(true);
  });
});
