import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { createNativeRendererPresentation, currentNativeRendererPresentation, withRendererPresentation } from '../../src/js/native-renderer-presentation.js';

// Reusing a mock slot overwrites the same texture, just like the actual GPU
// cache. This catches an overview alias being overwritten by a later fine.
const driver=vi.hoisted(()=>({renderer:null,captureAllowed:true,frame:0,cache:null,lost:false,generation:0,roomWidth:393}));
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
  const validFrame=frame=>Boolean(frame?.texture && !frame.texture.disposed && !driver.lost && frame.generation===driver.generation);
  const exactFrame=frame=>!driver.lost && frame && [frame.width,frame.height,frame.ratio].every(value=>Number.isFinite(value)&&value>0) && [frame.width*frame.ratio,frame.height*frame.ratio,(frame.x||0)*frame.ratio,(frame.y||0)*frame.ratio].every(Number.isInteger);
  const cache={exactFrame,capture:vi.fn((slot,frame)=>{
    if(!driver.captureAllowed || ![frame.width*frame.ratio,frame.height*frame.ratio].every(Number.isInteger))return null;
    let texture=slots.get(slot);
    if(!texture || texture.width!==frame.width*frame.ratio || texture.height!==frame.height*frame.ratio){
      if(texture)texture.disposed=true;
      texture={width:frame.width*frame.ratio,height:frame.height*frame.ratio};slots.set(slot,texture);
    }
    texture.pixels=structuredClone(renderer.domElement.frame);
    return {...frame,texture,generation:driver.generation,get pixels(){return texture.pixels;}};
  }),prepare:vi.fn(),repaint:vi.fn(frame=>{if(!validFrame(frame))return false;size(frame);renderer.domElement.frame=structuredClone(frame.texture.pixels);return true;}),
    compose:vi.fn((output,layers)=>{if(!exactFrame(output)||layers.some(layer=>!validFrame(layer.frame)))return false;size(output);renderer.domElement.frame={layers:layers.map(layer=>({pixels:structuredClone(layer.frame.texture.pixels),x:layer.x,y:layer.y,scale:layer.scale,clip:layer.clip}))};return true;}),
    validFrame,releaseSlot:vi.fn(slot=>{const texture=slots.get(slot);if(texture)texture.disposed=true;slots.delete(slot);}),dispose:vi.fn()};
  driver.cache=cache;return cache;
}}));

let shelf,stage,scroller,contexts,frames,clock,flyouts;
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
  driver.captureAllowed=true;driver.frame=0;driver.lost=false;driver.generation=0;driver.roomWidth=393;contexts=new WeakMap();frames=new Map();clock=0;flyouts=[];
  class TestContext extends Context {drawImage(...args){return super.drawImage(...args);}getImageData(...args){return super.getImageData(...args);}}
  vi.stubGlobal('CanvasRenderingContext2D',TestContext);vi.stubGlobal('devicePixelRatio',2);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){
    if(kind!=='2d')return null;if(!contexts.has(this))contexts.set(this,new TestContext(this));return contexts.get(this);
  });
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
  let serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));vi.spyOn(performance,'now').mockImplementation(()=>clock);
  vi.stubGlobal('innerWidth',393);vi.stubGlobal('innerHeight',844);
  window.matchMedia=()=>({matches:false});
  createRoom(393);
});
afterEach(()=>{for(const flyout of flyouts)flyout.remove();shelf?.dispose();shelf=null;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});

function createRoom(width) {
  shelf?.dispose();scroller?.remove();driver.roomWidth=width;
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:700});scroller.getBoundingClientRect=()=>rect(20,60,width,700);
  stage.getBoundingClientRect=()=>rect(20,60,width,750);
  shelf=createBookshelfScene({stage,scroller,width,height:750,rows:[{top:20,bottom:220}],entries:[]});
  shelf.canvas.getBoundingClientRect=()=>rect(20,60,width,700);shelf.flush();
}
function startInsertion({duration=180,overlayRatio=2,overlayHeight=Math.round(844*overlayRatio)}={}) {
  const node=document.createElement('button');node.className='ihr-spine';node.dataset.bookId='legacy';stage.append(node);
  shelf.updateLayout({stage,scroller,width:driver.roomWidth,height:750,rows:[{top:20,bottom:220}],entries:[{
    node,book:{id:'legacy',title:'Legacy room book',format:'PDF'},style:{color:'#42604b',width:40},
    x:150,y:100,width:132,height:200,thickness:40,shelf:0}]});shelf.flush();
  node.classList.add('is-away');shelf.flush();
  const renderer=driver.renderer,viewport=new THREE.Vector4(0,0,393,700),scissor=new THREE.Vector4();let scissorTest=false;
  renderer.getViewport=target=>target.copy(viewport);
  renderer.setViewport=(a,b,c,d)=>a?.isVector4?viewport.copy(a):viewport.set(a,b,c,d);
  renderer.getScissor=target=>target.copy(scissor);renderer.setScissor=(a,b,c,d)=>a?.isVector4?scissor.copy(a):scissor.set(a,b,c,d);
  renderer.getScissorTest=()=>scissorTest;renderer.setScissorTest=value=>{scissorTest=value;};renderer.clear=vi.fn();
  const flyout=document.createElement('div'),host=document.createElement('div'),overlay=document.createElement('canvas');
  overlay.width=Math.round(393*overlayRatio);overlay.height=overlayHeight;overlay.getBoundingClientRect=()=>rect(0,0,393,844);
  host.append(overlay);flyout.append(host);document.body.append(flyout);flyout.getBoundingClientRect=()=>rect(0,0,393,844);flyouts.push(flyout);
  let lease,cancelOwned=false;
  const output=overlay.getContext('2d'),bridge={context:output,
    createLease:vi.fn(callbacks=>lease=createNativeRendererPresentation(renderer,{...callbacks,canvas:overlay,context:output})),
    commit:vi.fn(lease=>lease.isOwner()),fallback:vi.fn(),cancel:vi.fn(()=>{cancelOwned=Boolean(lease?.isOwner());lease?.dispose({snapshot:false});})};
  const roomContext=contexts.get(shelf.canvas),roomPixels=structuredClone(roomContext.frame),copies=roomContext.copies.length;
  driver.cache.compose.mockClear();driver.cache.capture.mockClear();
  const motion=shelf.returnBook(node,{duration,overlayCanvas:overlay,nativePresentation:bridge});
  return {node,overlay,output,bridge,motion,roomContext,roomPixels,copies,get lease(){return lease;},get cancelOwned(){return cancelOwned;}};
}

describe('legacy insertion replay retains the displayed book without a second GPU copy',()=>{
  it('captures just the book once and keeps the full visible legacy composition',()=>{
    const state=startInsertion();expect(state.motion).not.toBeNull();expect(state.lease.isOwner()).toBe(true);
    expect(driver.cache.capture).toHaveBeenCalledOnce();
    expect(driver.cache.capture.mock.calls[0][1]).toMatchObject({sourceX:0,sourceY:0,ratio:2});
    expect(driver.cache.compose).toHaveBeenCalledOnce();
    expect(driver.cache.compose.mock.calls[0][0]).toEqual({x:0,y:0,width:393,height:844,ratio:2});
    expect(driver.cache.compose.mock.calls[0][1]).toHaveLength(1);
    expect(state.roomContext.frame).toEqual(state.roomPixels);expect(state.output.copies).toHaveLength(0);
    expect(state.bridge.fallback).not.toHaveBeenCalled();
  });
  it('replays the latest one-layer composition after a foreign render and export',()=>{
    const state=startInsertion();const initial=structuredClone(driver.renderer.domElement.frame);
    const foreign=document.createElement('canvas'),output=foreign.getContext('2d');
    withRendererPresentation(driver.renderer,null,()=>{
      driver.renderer.domElement.frame={foreign:true};output.drawImage(driver.renderer.domElement,0,0);
    });
    expect(output.frame).toEqual({foreign:true});expect(driver.renderer.domElement.frame).toEqual(initial);
    expect(state.lease.isOwner()).toBe(true);expect(state.roomContext.frame).toEqual(state.roomPixels);
    expect(driver.cache.capture).toHaveBeenCalledOnce();
    expect(driver.cache.compose).toHaveBeenCalledTimes(2);
  });
  it('exports only the book and restores its full native presentation without another capture',()=>{
    const state=startInsertion();const initial=structuredClone(driver.renderer.domElement.frame);
    state.lease.capture();
    expect(state.output.frame).toEqual(initial.layers[0].pixels);
    expect(driver.renderer.domElement.frame).toEqual(initial);expect(state.lease.isOwner()).toBe(true);
    expect(state.output.copies).toHaveLength(1);expect(driver.cache.capture).toHaveBeenCalledOnce();
    state.lease.capture();expect(state.output.copies).toHaveLength(1);
  });
  it('updates the frozen replay descriptor after each real insertion frame',()=>{
    const state=startInsertion();const first=structuredClone(driver.renderer.domElement.frame);
    const callbacks=[...frames.values()];frames.clear();clock=60;for(const callback of callbacks)callback(clock);
    const next=structuredClone(driver.renderer.domElement.frame);expect(next).not.toEqual(first);
    state.lease.repaint();expect(driver.renderer.domElement.frame).toEqual(next);
    expect(driver.cache.capture).toHaveBeenCalledTimes(2);
    expect(driver.cache.capture.mock.calls.every(([,descriptor])=>descriptor.sourceX===0&&descriptor.sourceY===0)).toBe(true);
    expect(state.bridge.fallback).not.toHaveBeenCalled();
  });
  it('preserves the aligned native room and its original complete-frame capture',()=>{
    createRoom(390);const state=startInsertion();expect(state.motion).not.toBeNull();
    expect(shelf.getNativeRoomBackground()).not.toBeNull();expect(driver.cache.capture).toHaveBeenCalledTimes(2);
    expect(driver.cache.capture.mock.calls[1][1]).toEqual({x:0,y:0,width:393,height:844,ratio:2});
    expect(driver.cache.compose.mock.calls[0][1]).toHaveLength(2);
    const initial=structuredClone(driver.renderer.domElement.frame);state.lease.capture();
    expect(driver.renderer.domElement.frame).toEqual(initial);expect(state.lease.isOwner()).toBe(true);
  });
  it('keeps the original complete capture when the export dimensions do not match the exact viewport',()=>{
    const state=startInsertion({overlayHeight:1687});expect(state.motion).not.toBeNull();
    expect(driver.cache.capture).toHaveBeenCalledTimes(2);
    expect(driver.cache.capture.mock.calls[1][1]).toEqual({x:0,y:0,width:393,height:844,ratio:2});
    const initial=structuredClone(driver.renderer.domElement.frame);state.lease.capture();
    expect(driver.renderer.domElement.frame).toEqual(initial);expect(state.bridge.fallback).not.toHaveBeenCalled();
  });
  it('exports a completed book after legacy ownership is released without disturbing the real room',async()=>{
    const state=startInsertion({duration:0});await state.motion.finished;
    const book=structuredClone(driver.renderer.domElement.frame.layers[0].pixels);
    state.node.classList.remove('is-away');shelf.invalidate();shelf.flush();
    const room=structuredClone(state.roomContext.frame),copies=state.roomContext.copies.length;
    expect(state.lease.isOwner()).toBe(false);expect(driver.renderer.domElement.isConnected).toBe(false);
    state.lease.capture();expect(state.output.frame).toEqual(book);
    expect(state.roomContext.frame).toEqual(room);expect(state.roomContext.copies).toHaveLength(copies);
    expect(driver.renderer.domElement.isConnected).toBe(false);
  });
  it('refuses lost or restored-generation frames before replay or export, then disposes once',()=>{
    const state=startInsertion();const initial=structuredClone(driver.renderer.domElement.frame);
    driver.cache.compose.mockClear();driver.cache.repaint.mockClear();driver.lost=true;
    expect(state.lease.repaint()).toBe(false);state.lease.capture();
    expect(driver.cache.compose).not.toHaveBeenCalled();expect(driver.cache.repaint).not.toHaveBeenCalled();
    expect(state.output.copies).toHaveLength(0);driver.lost=false;driver.generation++;
    expect(state.lease.repaint()).toBe(false);expect(driver.renderer.domElement.frame).toEqual(initial);
    state.motion.cancel();expect(state.bridge.cancel).toHaveBeenCalledOnce();
    expect(currentNativeRendererPresentation(driver.renderer)).toBeNull();
    state.lease.dispose();expect(driver.cache.releaseSlot).toHaveBeenCalledTimes(2);
  });
  it('keeps the original no-frame fallback and rejects unsupported fractional overlay pixels',()=>{
    const state=startInsertion({overlayRatio:1.25});expect(state.motion).toBeNull();
    expect(state.bridge.createLease).not.toHaveBeenCalled();expect(state.bridge.commit).not.toHaveBeenCalled();
    expect(state.bridge.fallback).not.toHaveBeenCalled();expect(driver.cache.capture).not.toHaveBeenCalled();
    expect(state.roomContext.copies).toHaveLength(state.copies);expect(state.output.copies).toHaveLength(0);
  });
});
