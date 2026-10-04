import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { createNativeRendererPresentation, currentNativeRendererPresentation } from '../../src/js/native-renderer-presentation.js';

// The actual shelf, bridge and ownership paths run here. Only the GPU/cache
// driver is faked; frame identity and each physical buffer assignment remain
// observable so the test cannot hide an obsolete room restoration.
const driver = vi.hoisted(() => ({renderer:null,cache:null,frame:0,writes:[],copyOwners:[],failCopyClass:null}));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three'); let ratio = 1; const size = new Three.Vector2();
  const renderer = {domElement:document.createElement('canvas'),shadowMap:{},info:{render:{calls:0},memory:{},programs:[]},
    capabilities:{getMaxAnisotropy:()=>1},getPixelRatio:()=>ratio,setPixelRatio:value=>{ratio=value;},
    getSize:target=>target.copy(size),setViewport(){},setSize:(width,height)=>{
      size.set(width,height);renderer.domElement.width=width*ratio;renderer.domElement.height=height*ratio;
      driver.writes.push({width:renderer.domElement.width,height:renderer.domElement.height});
    },render:()=>{renderer.domElement.frame={scene:++driver.frame};renderer.info.render.calls++;}};
  driver.renderer = renderer;
  return {getBookRenderer:()=>renderer,lightBookScene(){},createBookModel(book,_style,width,height,thickness){
    const model = new Three.Group(); model.name = `book:${book.id}`;
    model.add(new Three.Mesh(new Three.BoxGeometry(width,height,thickness),new Three.MeshStandardMaterial()));
    model.userData.dispose=()=>{}; return model;
  }};
});
vi.mock('../../src/js/native-room-cache.js',()=>({createNativeFramebufferCache:renderer=>{
  const slots = new Map(), size = new THREE.Vector2();
  const resize = frame => {
    if(renderer.getPixelRatio()!==frame.ratio)renderer.setPixelRatio(frame.ratio);
    renderer.getSize(size);
    if(size.x!==frame.width || size.y!==frame.height)renderer.setSize(frame.width,frame.height,false);
  };
  const cache = {capture:vi.fn((slot,frame)=>{
    if(![frame.width*frame.ratio,frame.height*frame.ratio].every(Number.isInteger))return null;
    let texture=slots.get(slot);
    if(!texture || texture.width!==frame.width*frame.ratio || texture.height!==frame.height*frame.ratio){
      if(texture)texture.disposed=true;
      texture={width:frame.width*frame.ratio,height:frame.height*frame.ratio};slots.set(slot,texture);
    }
    texture.pixels=structuredClone(renderer.domElement.frame);
    return {...frame,texture,get pixels(){return texture.pixels;}};
  }),prepare:vi.fn(),repaint:vi.fn(frame=>{resize(frame);renderer.domElement.frame=structuredClone(frame.pixels);return true;}),
    compose:vi.fn((output,layers)=>{resize(output);renderer.domElement.frame={layers:layers.map(layer=>({pixels:structuredClone(layer.frame.pixels),x:layer.x,y:layer.y,scale:layer.scale,clip:layer.clip}))};return true;}),
    validFrame:frame=>Boolean(frame?.texture && !frame.texture.disposed),releaseSlot:vi.fn(),dispose:vi.fn()};
  driver.cache=cache; return cache;
}}));

let shelf,stage,scroller,contexts,frames,clock,flyouts;
class Context {
  constructor(canvas){this.canvas=canvas;this.copies=[];this.frame=null;}
  clearRect(){this.frame=null;}
  drawImage(source,...args){
    driver.copyOwners.push(currentNativeRendererPresentation(driver.renderer));
    if(driver.failCopyClass===this.canvas.className){driver.failCopyClass=null;throw new Error('Fixture copy failed');}
    this.frame=structuredClone(source.frame||contexts.get(source)?.frame||null);this.copies.push({source,args});
  }
  getImageData(){return {frame:structuredClone(this.frame),data:new Uint8ClampedArray(4)};}
  createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4)};}
  putImageData(){}
}
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
const outputs=()=>({fine:stage.querySelector('.ihr-bookshelf-inspection-snapshot'),overview:stage.querySelector('.ihr-bookshelf-inspection-overview')});
beforeEach(()=>{
  driver.frame=0;driver.writes=[];driver.copyOwners=[];driver.failCopyClass=null;
  contexts=new WeakMap();frames=new Map();clock=0;flyouts=[];
  class TestContext extends Context {drawImage(...args){return super.drawImage(...args);}getImageData(...args){return super.getImageData(...args);}}
  vi.stubGlobal('CanvasRenderingContext2D',TestContext);vi.stubGlobal('devicePixelRatio',2);
  vi.stubGlobal('innerWidth',390);vi.stubGlobal('innerHeight',844);
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
  shelf.canvas.getBoundingClientRect=()=>rect(20,60,390,700);shelf.flush();
});
afterEach(()=>{
  for(const flyout of flyouts)flyout.remove();shelf?.dispose();shelf=null;document.body.innerHTML='';
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

function startInsertion({duration=180,hostLeft=0,hostTop=0,overlayLeft=0}={}) {
  const node=document.createElement('button');node.className='ihr-spine';node.dataset.bookId='owned';stage.append(node);
  shelf.updateLayout({stage,scroller,width:390,height:750,rows:[{top:20,bottom:220}],entries:[{
    node,book:{id:'owned',title:'Actual native owner',format:'PDF'},style:{color:'#42604b',width:40},
    x:150,y:100,width:132,height:200,thickness:40,shelf:0}]});shelf.flush();
  node.classList.add('is-away');shelf.flush();
  const renderer=driver.renderer,viewport=new THREE.Vector4(0,0,390,700),scissor=new THREE.Vector4();let scissorTest=false;
  renderer.getViewport=target=>target.copy(viewport);
  renderer.setViewport=(a,b,c,d)=>a?.isVector4?viewport.copy(a):viewport.set(a,b,c,d);
  renderer.getScissor=target=>target.copy(scissor);renderer.setScissor=(a,b,c,d)=>a?.isVector4?scissor.copy(a):scissor.set(a,b,c,d);
  renderer.getScissorTest=()=>scissorTest;renderer.setScissorTest=value=>{scissorTest=value;};renderer.clear=vi.fn();
  const flyout=document.createElement('div'),host=document.createElement('div'),overlay=document.createElement('canvas');
  host.className='ihr-flyout__book';host.getBoundingClientRect=()=>rect(hostLeft,hostTop,390,844);
  overlay.width=780;overlay.height=1688;overlay.getBoundingClientRect=()=>rect(overlayLeft,0,390,844);
  host.append(overlay);flyout.append(host);document.body.append(flyout);flyout.getBoundingClientRect=()=>rect(0,0,390,844);flyouts.push(flyout);
  let lease;const output=overlay.getContext('2d');
  const bridge={context:output,createLease:vi.fn(callbacks=>lease=createNativeRendererPresentation(renderer,{...callbacks,canvas:overlay,context:output})),
    commit:vi.fn(current=>current.isOwner()),fallback:vi.fn(()=>lease?.dispose({snapshot:false})),cancel:vi.fn(()=>lease?.dispose({snapshot:false}))};
  const motion=shelf.returnBook(node,{duration,overlayCanvas:overlay,nativePresentation:bridge});
  return {node,host,overlay,output,bridge,motion,get lease(){return lease;}};
}

describe('actual native insertion ownership and cached CSS handoff',()=>{
  it('parents the actual shared-depth native frame inside its book host with exact viewport geometry',()=>{
    const state=startInsertion({hostLeft:13,hostTop:17}),native=driver.renderer.domElement;
    expect(state.motion).not.toBeNull();expect(state.lease.isOwner()).toBe(true);expect(state.bridge.commit).toHaveBeenCalledOnce();
    expect(native.parentElement).toBe(state.host);expect(state.host.querySelector('.ihr-shelf-insertion-live-canvas')).toBe(native);
    expect(native.style.left).toBe('-13px');expect(native.style.top).toBe('-17px');
    expect(native.style.width).toBe('390px');expect(native.style.height).toBe('844px');
    expect(native.width).toBe(780);expect(native.height).toBe(1688);
    expect(native.dataset.insertionDepth).toBe('shared-shelf');expect(native.dataset.returnProgress).toBe('0.0000');
    expect(native.dataset.returnProgress).toBe(state.overlay.dataset.returnProgress);
    expect(state.overlay.style.opacity).toBe('0');expect(state.output.copies).toHaveLength(0);
  });
  it('reports each actually painted return pose on the native canvas and the same export canvas',()=>{
    const state=startInsertion(),native=driver.renderer.domElement;
    for(const now of [45,90,135]){
      clock=now;shelf.flush();
      expect(native.parentElement).toBe(state.host);expect(state.lease.isOwner()).toBe(true);
      expect(native.dataset.insertionDepth).toBe('shared-shelf');expect(native.dataset.returnProgress).toBe(shelf.canvas.dataset.returnProgress);
      expect(native.dataset.returnProgress).toBe(state.overlay.dataset.returnProgress);expect(Number(native.dataset.returnProgress)).toBeCloseTo(now/180,4);
    }
    expect(state.bridge.fallback).not.toHaveBeenCalled();expect(state.output.copies).toHaveLength(0);
  });
  it('clears book diagnostics and restores the actual room on cancellation',()=>{
    const state=startInsertion(),native=driver.renderer.domElement;state.motion.cancel();
    expect(state.bridge.cancel).toHaveBeenCalledOnce();expect(state.lease.isOwner()).toBe(false);
    expect(native.parentElement.className).toBe('ihr-bookshelf-native-room-clip');
    expect(native.className).toBe('ihr-bookshelf-native-room-canvas');expect(shelf.getNativeRoomBackground().lease.isOwner()).toBe(true);
    expect(native.dataset.insertionDepth).toBeUndefined();expect(native.dataset.returnProgress).toBeUndefined();
  });
  it('does not let old book cleanup remove a transferred room or a newer book metadata owner',async()=>{
    const first=startInsertion({duration:0});await first.motion.finished;first.node.classList.remove('is-away');shelf.invalidate();shelf.flush();
    const native=driver.renderer.domElement;expect(native.parentElement.className).toBe('ihr-bookshelf-native-room-clip');
    expect(native.dataset.insertionDepth).toBeUndefined();expect(native.dataset.returnProgress).toBeUndefined();
    const second=startInsertion();expect(second.lease.isOwner()).toBe(true);expect(native.parentElement).toBe(second.host);
    first.lease.dispose({snapshot:false});
    expect(second.lease.isOwner()).toBe(true);expect(native.parentElement).toBe(second.host);
    expect(native.dataset.insertionDepth).toBe('shared-shelf');expect(native.dataset.returnProgress).toBe('0.0000');
  });
  it('does not stamp a native pose when its full-viewport presentation geometry is invalid',()=>{
    const state=startInsertion({overlayLeft:1}),native=driver.renderer.domElement;
    expect(state.motion).not.toBeNull();expect(state.bridge.fallback).toHaveBeenCalledOnce();
    expect(state.bridge.commit).not.toHaveBeenCalled();expect(shelf.getNativeRoomBackground().lease.isOwner()).toBe(true);
    expect(native.dataset.insertionDepth).toBeUndefined();expect(native.dataset.returnProgress).toBeUndefined();
  });
  it('releases the obsolete native room before materializing unchanged CSS tiles and assigns only one buffer size',()=>{
    shelf.setMode('isometric',{animate:false});shelf.flush();
    const background=shelf.getNativeRoomBackground(),pixels=structuredClone(background.frame.pixels),{fine,overview}=outputs();
    driver.writes=[];driver.copyOwners=[];
    shelf.setInspectionView({zoom:1.1,panX:0,panY:0},{moving:true,renderNow:true});
    expect(driver.copyOwners).toHaveLength(2);expect(driver.copyOwners.every(owner=>owner===null)).toBe(true);
    expect(driver.writes).toEqual([{width:969,height:1434}]);
    expect(contexts.get(fine).copies).toHaveLength(1);expect(contexts.get(overview).copies).toHaveLength(1);
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual(pixels);
    expect(fine.style.display).toBe('block');expect(overview.style.display).toBe('block');
    expect(fine.style.transform).toBe(overview.style.transform);expect(shelf.canvas.style.visibility).toBe('hidden');
    expect(background.lease.isOwner()).toBe(false);expect(driver.renderer.domElement.isConnected).toBe(false);
    shelf.setInspectionView({zoom:1.2,panX:10,panY:0},{moving:true,renderNow:true});
    expect(driver.writes).toHaveLength(1);expect(contexts.get(fine).copies).toHaveLength(1);expect(contexts.get(overview).copies).toHaveLength(1);
    expect(contexts.get(fine).frame).toEqual(pixels);expect(contexts.get(overview).frame).toEqual(pixels);
  });
  it('restores the previous complete native room and leaves CSS tiles hidden when materialization fails',()=>{
    shelf.setMode('isometric',{animate:false});shelf.flush();
    const background=shelf.getNativeRoomBackground(),native=driver.renderer.domElement,parent=native.parentElement,
      pixels=structuredClone(native.frame),{fine,overview}=outputs();
    driver.failCopyClass=fine.className;
    expect(()=>shelf.setInspectionView({zoom:1.1,panX:0,panY:0},{moving:true,renderNow:true})).toThrow('Fixture copy failed');
    expect(background.lease.isOwner()).toBe(true);expect(native.parentElement).toBe(parent);expect(native.isConnected).toBe(true);
    expect(native.frame).toEqual(pixels);expect(native.width).toBe(585);expect(native.height).toBe(1050);
    expect(fine.style.display).toBe('none');expect(overview.style.display).toBe('none');expect(shelf.canvas.style.visibility).toBe('');
    expect(parent.style.display).toBe('block');expect(shelf.canvas.style.opacity).toBe('0');
  });
});
