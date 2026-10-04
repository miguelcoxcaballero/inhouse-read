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

const gpuCopies=()=>Object.values(outputs()).flatMap(canvas=>contexts.get(canvas).copies).filter(copy=>copy.source===driver.renderer.domElement);
const clearCopies=()=>{for(const canvas of Object.values(outputs()))contexts.get(canvas).copies=[];};
const gesture=()=>shelf.setInspectionView({zoom:1.1,panX:0,panY:0},{moving:true,renderNow:true});

describe('ephemeral same-batch inspection materialization',()=>{
  it('uses exactly one GPU readback for a new shared fine/overview gesture batch',()=>{
    fitted();const {fine,overview}=outputs(),pixels=structuredClone(shelf.getNativeRoomBackground().frame.pixels);
    clearCopies();gesture();
    expect(gpuCopies()).toHaveLength(1);
    expect(contexts.get(overview).copies.at(-1).source).toBe(driver.renderer.domElement);
    expect(contexts.get(fine).copies.at(-1).source).toBe(overview);
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual(pixels);
    expect(fine.style.transform).toBe(overview.style.transform);expect(fine.style.display).toBe('block');
    expect(overview.style.display).toBe('block');expect(driver.renderer.domElement.isConnected).toBe(false);
  });
  it('keeps independent external exports and never propagates a consumer-edited canvas',()=>{
    fitted();const {fine,overview}=outputs(),pixels=structuredClone(shelf.getNativeRoomBackground().frame.pixels);
    clearCopies();overview.getContext('2d').getImageData();contexts.get(overview).frame={consumerEdited:true};
    fine.getContext('2d').getImageData();
    expect(gpuCopies()).toHaveLength(2);expect(contexts.get(overview).frame).toEqual({consumerEdited:true});
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(fine).copies.at(-1).source).toBe(driver.renderer.domElement);
  });
  it('does not issue a reuse receipt for an already materialized and externally edited overview',()=>{
    fitted();const {fine,overview}=outputs(),pixels=structuredClone(shelf.getNativeRoomBackground().frame.pixels);
    overview.getContext('2d').getImageData();contexts.get(overview).frame={consumerEdited:true};clearCopies();gesture();
    expect(gpuCopies()).toHaveLength(1);expect(contexts.get(fine).copies.at(-1).source).toBe(driver.renderer.domElement);
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual({consumerEdited:true});
  });
  it('keeps an externally edited fine independent when only the overview needs a new batch capture',()=>{
    fitted();const {fine,overview}=outputs(),pixels=structuredClone(shelf.getNativeRoomBackground().frame.pixels);
    fine.getContext('2d').getImageData();contexts.get(fine).frame={consumerEdited:true};clearCopies();gesture();
    expect(gpuCopies()).toHaveLength(1);expect(contexts.get(fine).copies).toHaveLength(0);
    expect(contexts.get(fine).frame).toEqual({consumerEdited:true});expect(contexts.get(overview).frame).toEqual(pixels);
  });
  it('reuses a new shared descriptor after unequal independent fine/overview revisions advance',()=>{
    fitted();view(2);view(3,10,0);view(1);
    const pixels=structuredClone(shelf.getNativeRoomBackground().frame.pixels),{fine,overview}=outputs();clearCopies();gesture();
    expect(gpuCopies()).toHaveLength(1);expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual(pixels);
  });
  it('keeps distinct fine/overview descriptors and their pixels independent',()=>{
    fitted();const old=structuredClone(shelf.getNativeRoomBackground().frame.pixels);view(2);
    const current=structuredClone(shelf.getNativeRoomBackground().frame.pixels),{fine,overview}=outputs();clearCopies();
    shelf.setInspectionView({zoom:2.1,panX:0,panY:0},{moving:true,renderNow:true});
    expect(gpuCopies()).toHaveLength(2);expect(contexts.get(fine).frame).toEqual(current);expect(contexts.get(overview).frame).toEqual(old);
  });
  it('uses independent GPU captures when canvas dimensions differ despite the shared descriptor',()=>{
    fitted();const {fine,overview}=outputs();overview.width+=1;clearCopies();gesture();
    expect(gpuCopies()).toHaveLength(2);expect(contexts.get(fine).copies.at(-1).source).toBe(driver.renderer.domElement);
    expect(contexts.get(overview).copies.at(-1).source).toBe(driver.renderer.domElement);
  });
  it('retains the old overview export after a fallback clears fine and a new fine is captured',()=>{
    fitted();const oldFrame=shelf.getNativeRoomBackground().frame,oldPixels=structuredClone(oldFrame.pixels);
    driver.captureAllowed=false;view(2);driver.captureAllowed=true;view(2);
    const current=shelf.getNativeRoomBackground().frame,{fine,overview}=outputs();clearCopies();
    fine.getContext('2d').getImageData();overview.getContext('2d').getImageData();
    expect(gpuCopies()).toHaveLength(2);expect(current.texture).not.toBe(oldFrame.texture);
    expect(oldFrame.texture.disposed).not.toBe(true);expect(contexts.get(overview).frame).toEqual(oldPixels);
    expect(contexts.get(fine).frame).toEqual(current.pixels);
  });
});
