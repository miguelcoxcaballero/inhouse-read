import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { createNativeRendererPresentation, currentNativeRendererPresentation } from '../../src/js/native-renderer-presentation.js';

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
  driver.captureAllowed=true;driver.frame=0;contexts=new WeakMap();frames=new Map();clock=0;flyouts=[];
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
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:700});scroller.getBoundingClientRect=()=>rect(20,60,393,700);
  stage.getBoundingClientRect=()=>rect(20,60,393,750);
  shelf=createBookshelfScene({stage,scroller,width:393,height:750,rows:[{top:20,bottom:220}],entries:[]});
  shelf.canvas.getBoundingClientRect=()=>rect(20,60,393,700);shelf.flush();
});
afterEach(()=>{for(const flyout of flyouts)flyout.remove();shelf?.dispose();shelf=null;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});

function startInsertion({duration=180,overlayRatio=2}={}) {
  const node=document.createElement('button');node.className='ihr-spine';node.dataset.bookId='legacy';stage.append(node);
  shelf.updateLayout({stage,scroller,width:393,height:750,rows:[{top:20,bottom:220}],entries:[{
    node,book:{id:'legacy',title:'Legacy room book',format:'PDF'},style:{color:'#42604b',width:40},
    x:150,y:100,width:132,height:200,thickness:40,shelf:0}]});shelf.flush();
  node.classList.add('is-away');shelf.flush();
  const renderer=driver.renderer,viewport=new THREE.Vector4(0,0,393,700),scissor=new THREE.Vector4();let scissorTest=false;
  renderer.getViewport=target=>target.copy(viewport);
  renderer.setViewport=(a,b,c,d)=>a?.isVector4?viewport.copy(a):viewport.set(a,b,c,d);
  renderer.getScissor=target=>target.copy(scissor);renderer.setScissor=(a,b,c,d)=>a?.isVector4?scissor.copy(a):scissor.set(a,b,c,d);
  renderer.getScissorTest=()=>scissorTest;renderer.setScissorTest=value=>{scissorTest=value;};renderer.clear=vi.fn();
  const flyout=document.createElement('div'),host=document.createElement('div'),overlay=document.createElement('canvas');
  overlay.width=Math.round(393*overlayRatio);overlay.height=Math.round(844*overlayRatio);overlay.getBoundingClientRect=()=>rect(0,0,393,844);
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

describe('native transparent insertion over an unchanged legacy room',()=>{
  it('keeps the 393px room pixels visible while presenting only the book at exact DPR2 with no readback',()=>{
    const state=startInsertion();expect(state.motion).not.toBeNull();expect(shelf.getNativeRoomBackground()).toBeNull();
    expect(shelf.canvas.dataset.nativeRoomPresentation).toBe('false');expect(shelf.canvas.style.opacity).toBe('');
    expect(state.roomContext.frame).toEqual(state.roomPixels);expect(state.roomContext.copies).toHaveLength(state.copies);
    expect(state.output.copies).toHaveLength(0);expect(state.overlay.style.opacity).toBe('0');expect(state.lease.isOwner()).toBe(true);
    expect(driver.renderer.domElement.className).toBe('ihr-shelf-insertion-live-canvas');
    expect(driver.renderer.domElement.width).toBe(786);expect(driver.renderer.domElement.height).toBe(1688);
    expect(driver.cache.compose).toHaveBeenCalledOnce();expect(driver.cache.compose.mock.calls[0][1]).toHaveLength(1);
    expect(driver.cache.compose.mock.calls[0][1][0].frame.ratio).toBe(2);expect(state.bridge.fallback).not.toHaveBeenCalled();
  });
  it('releases the completed native lease before the actual final legacy room paint and never restores the old book',async()=>{
    const state=startInsertion({duration:0});expect(state.motion).not.toBeNull();await state.motion.finished;
    expect(state.lease.isOwner()).toBe(true);state.node.classList.remove('is-away');
    const render=driver.renderer.render,owners=[];driver.renderer.render=()=>{owners.push(currentNativeRendererPresentation(driver.renderer));render();};
    shelf.invalidate();shelf.flush();
    expect(owners.length).toBeGreaterThan(0);expect(owners.every(owner=>owner===null)).toBe(true);
    expect(currentNativeRendererPresentation(driver.renderer)).toBeNull();expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(state.roomContext.copies.length).toBeGreaterThan(state.copies);expect(shelf.canvas.style.opacity).toBe('');
    expect(state.output.copies).toHaveLength(0);expect(state.bridge.cancel).not.toHaveBeenCalled();
  });
  it('retains the completed presentation across held paints until a real final room paint is permitted',async()=>{
    const state=startInsertion({duration:0});expect(state.motion).not.toBeNull();await state.motion.finished;
    shelf.setPaintHeld(true);state.node.classList.remove('is-away');shelf.invalidate();shelf.flush();
    expect(state.lease.isOwner()).toBe(true);expect(driver.renderer.domElement.isConnected).toBe(true);
    expect(state.roomContext.copies).toHaveLength(state.copies);expect(state.output.copies).toHaveLength(0);
    shelf.setPaintHeld(false);shelf.flush();
    expect(state.lease.isOwner()).toBe(false);expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(state.roomContext.copies.length).toBeGreaterThan(state.copies);expect(shelf.canvas.style.opacity).toBe('');
  });
  it('lets the existing bridge restore the closed flyout on cancel before painting the legacy room',()=>{
    const state=startInsertion();expect(state.motion).not.toBeNull();expect(state.lease.isOwner()).toBe(true);
    state.motion.cancel();expect(state.bridge.cancel).toHaveBeenCalledOnce();expect(state.cancelOwned).toBe(true);
    expect(currentNativeRendererPresentation(driver.renderer)).toBeNull();expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(shelf.canvas.style.opacity).toBe('');expect(state.roomContext.copies.length).toBeGreaterThan(state.copies);
    expect(state.output.frame).toBeNull();expect(state.bridge.fallback).not.toHaveBeenCalled();
  });
  it('rejects noninteger overlay pixels before creating a lease so the original fractional fallback remains in charge',()=>{
    const state=startInsertion({overlayRatio:1.25});expect(state.motion).toBeNull();
    expect(state.bridge.createLease).not.toHaveBeenCalled();expect(state.bridge.commit).not.toHaveBeenCalled();
    expect(state.bridge.fallback).not.toHaveBeenCalled();expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(state.roomContext.copies).toHaveLength(state.copies);expect(state.output.copies).toHaveLength(0);
  });
});
