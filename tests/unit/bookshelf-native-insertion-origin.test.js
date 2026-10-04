import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { createNativeRendererPresentation, withRendererPresentation } from '../../src/js/native-renderer-presentation.js';

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

describe('native insertion preserves the original cropped raster origin',()=>{
  it('keeps the original viewport rounding when a fractional room needs the legacy canvas',()=>{
    driver.renderer.setViewport=vi.fn();vi.stubGlobal('devicePixelRatio',1.25);fitted();
    expect(shelf.getNativeRoomBackground()).toBeNull();expect(shelf.canvas.dataset.nativeRoomPresentation).toBe('false');
    expect(driver.renderer.setViewport).not.toHaveBeenCalled();
    expect(shelf.canvas.style.opacity).toBe('');expect(contexts.get(shelf.canvas).copies.length).toBeGreaterThan(0);
    expect(outputs().fine.width).toBe(808);expect(outputs().overview.width).toBe(808);
  });
  it.each([150,-30])('uses GL pixel zero and original crop-relative depth clipping at book x=%i',x=>{
    vi.stubGlobal('innerWidth',390);vi.stubGlobal('innerHeight',844);
    const node=document.createElement('button');node.className='ihr-spine';node.dataset.bookId='origin';stage.append(node);
    shelf.updateLayout({stage,scroller,width:390,height:750,rows:[{top:20,bottom:220}],entries:[{
      node,book:{id:'origin',title:'Raster origin',format:'PDF'},style:{color:'#42604b',width:40},
      x,y:100,width:132,height:200,thickness:40,shelf:0}]});shelf.flush();
    node.classList.add('is-away');shelf.flush();
    const renderer=driver.renderer,viewport=new THREE.Vector4(0,0,390,700),scissor=new THREE.Vector4(),painted=[];
    let scissorTest=false;
    renderer.getViewport=target=>target.copy(viewport);
    renderer.setViewport=vi.fn((a,b,c,d)=>a?.isVector4?viewport.copy(a):viewport.set(a,b,c,d));
    renderer.getScissor=target=>target.copy(scissor);renderer.setScissor=(a,b,c,d)=>a?.isVector4?scissor.copy(a):scissor.set(a,b,c,d);
    renderer.getScissorTest=()=>scissorTest;renderer.setScissorTest=value=>{scissorTest=value;};renderer.clear=vi.fn();
    const render=renderer.render;renderer.render=()=>{render();painted.push({viewport:viewport.toArray(),scissor:scissor.toArray(),scissorTest});};
    const flyout=document.createElement('div'),host=document.createElement('div'),overlay=document.createElement('canvas');
    overlay.width=780;overlay.height=1688;overlay.getBoundingClientRect=()=>rect(0,0,390,844);
    host.append(overlay);flyout.append(host);document.body.append(flyout);flyout.getBoundingClientRect=()=>rect(0,0,390,844);
    let lease;
    const bridge={context:overlay.getContext('2d'),
      createLease:callbacks=>lease=createNativeRendererPresentation(renderer,{...callbacks,canvas:overlay,context:overlay.getContext('2d')}),
      commit:vi.fn(lease=>lease.isOwner()),fallback:vi.fn(),cancel:()=>lease?.dispose({snapshot:false})};
    driver.cache.capture.mockClear();const motion=shelf.returnBook(node,{duration:180,overlayCanvas:overlay,nativePresentation:bridge});
    expect(motion).not.toBeNull();expect(bridge.fallback).not.toHaveBeenCalled();expect(bridge.commit).toHaveBeenCalledOnce();
    const descriptor=driver.cache.capture.mock.calls.find(([,frame])=>frame.sourceX!==undefined)?.[1];
    expect(descriptor).toBeTruthy();expect(descriptor.sourceX).toBe(0);expect(descriptor.sourceY).toBe(0);
    expect(descriptor.ratio).toBe(2);expect(descriptor.width).toBe(256);expect(descriptor.height).toBe(384);
    if(x<0)expect(descriptor.x).toBeLessThan(0);
    expect(painted).toHaveLength(2);
    for(const pass of painted)expect(pass.viewport).toEqual([0,0,descriptor.width,descriptor.height]);
    const left=Math.max(0,descriptor.x,20),right=Math.min(390,descriptor.x+descriptor.width,410);
    const top=Math.max(0,descriptor.y,60),bottom=Math.min(844,descriptor.y+descriptor.height,760);
    expect(painted[0].scissorTest).toBe(true);
    expect(painted[0].scissor).toEqual([left-descriptor.x,descriptor.height-(bottom-descriptor.y),right-left,bottom-top]);
    expect(painted[1].scissorTest).toBe(false);
    motion.cancel();flyout.remove();
  });
});
