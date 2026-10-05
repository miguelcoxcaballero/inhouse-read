import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { withRendererPresentation } from '../../src/js/native-renderer-presentation.js';

// The cache and lease are real. Only the GL driver pixels and room models are
// faked, using the original native-room fixture's scheduling and Canvas mocks.
const driver=vi.hoisted(()=>({renderer:null,frame:0,bufferSupported:true,lost:false}));
vi.mock('../../src/js/book-model.js',async()=>{
  const Three=await import('three');let ratio=1;const size=new Three.Vector2(),viewport=new Three.Vector4(),scissor=new Three.Vector4();
  let scissorTest=false,clearAlpha=0;const clearColor=new Three.Color();
  const renderer={domElement:document.createElement('canvas'),shadowMap:{enabled:true},autoClear:true,
    info:{render:{calls:0},memory:{},programs:[]},capabilities:{getMaxAnisotropy:()=>1,maxTextureSize:4096},
    getPixelRatio:()=>ratio,setPixelRatio(value){ratio=value;this.setSize(size.x,size.y);},
    getSize:target=>target.copy(size),setSize(width,height){size.set(width,height);this.domElement.width=Math.floor(width*ratio);this.domElement.height=Math.floor(height*ratio);},
    getViewport:target=>target.copy(viewport),setViewport(x,y,w,h){viewport.set(x,y,w,h);},
    getScissor:target=>target.copy(scissor),setScissor(value){scissor.copy(value);},
    getScissorTest:()=>scissorTest,setScissorTest:value=>{scissorTest=value;},
    getClearColor:target=>target.copy(clearColor),getClearAlpha:()=>clearAlpha,
    setClearColor(value,alpha){clearColor.set(value);clearAlpha=alpha;},getRenderTarget:()=>null,setRenderTarget(){},clear(){},compile(){return new Set();},
    copyFramebufferToTexture(texture){texture.pixels=structuredClone(this.domElement.frame);},
    render(scene){
      const material=scene.children[0]?.material;
      this.domElement.frame=material?.isRawShaderMaterial?structuredClone(material.uniforms.layer0.value.pixels):{scene:++driver.frame};
      this.info.render.calls++;
    }};
  const gl={get drawingBufferWidth(){return driver.bufferSupported?renderer.domElement.width:undefined;},
    get drawingBufferHeight(){return driver.bufferSupported?renderer.domElement.height:undefined;},isContextLost:()=>driver.lost};
  renderer.getContext=()=>gl;driver.renderer=renderer;
  return {getBookRenderer:()=>renderer,lightBookScene(){},createBookModel(book,_style,width,height,thickness){
    const model=new Three.Group();model.name=`book:${book.id}`;
    model.add(new Three.Mesh(new Three.BoxGeometry(width,height,thickness),new Three.MeshStandardMaterial()));
    model.userData.dispose=()=>{};return model;
  }};
});

let shelf,stage,scroller,contexts,allContexts,frames;
class Context {
  constructor(canvas){this.canvas=canvas;this.copies=[];this.frame=null;allContexts.push(this);}
  clearRect(){this.frame=null;}
  drawImage(source,...args){this.frame=structuredClone(source.frame||contexts.get(source)?.frame||null);this.copies.push({source,args});}
  getImageData(){return {frame:structuredClone(this.frame),data:new Uint8ClampedArray(4)};}
  createImageData(width,height){return {data:new Uint8ClampedArray(width*height*4)};}
  putImageData(){}
}
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
const fitted=()=>{shelf.setMode('isometric',{animate:false});shelf.flush();};
beforeEach(()=>{
  driver.frame=0;driver.bufferSupported=true;driver.lost=false;contexts=new WeakMap();allContexts=[];frames=new Map();
  class TestContext extends Context {drawImage(...args){return super.drawImage(...args);}getImageData(...args){return super.getImageData(...args);}}
  vi.stubGlobal('CanvasRenderingContext2D',TestContext);vi.stubGlobal('devicePixelRatio',2.75);
  vi.stubGlobal('innerWidth',393);vi.stubGlobal('innerHeight',844);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){
    if(kind!=='2d')return null;if(!contexts.has(this))contexts.set(this,new TestContext(this));return contexts.get(this);
  });
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
  let serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));vi.spyOn(performance,'now').mockReturnValue(0);
  window.matchMedia=()=>({matches:false});
  scroller=document.createElement('div');stage=document.createElement('div');scroller.append(stage);document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{value:783});scroller.getBoundingClientRect=()=>rect(.25,104.25,393,783);
  stage.getBoundingClientRect=()=>rect(.25,104.25,393,833);
  shelf=createBookshelfScene({stage,scroller,width:393,height:833,rows:[{top:20,bottom:220}],entries:[]});
  shelf.canvas.getBoundingClientRect=()=>rect(.25,104.25,393,783);shelf.flush();
});
afterEach(()=>{shelf?.dispose();shelf=null;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('fractional room presentation and lazy original 2D exports',()=>{
  it('presents the floor GL room at its original fractional CSS origin without an eager readback',()=>{
    const background=shelf.getNativeRoomBackground(),node=driver.renderer.domElement;
    expect(background.lease.isOwner()).toBe(true);
    expect(background.frame).toMatchObject({width:393,height:783,ratio:1.5,physical:true,pixelWidth:589,pixelHeight:1174});
    expect(node.width).toBe(589);expect(node.height).toBe(1174);
    expect(node.style.width).toBe('393px');expect(node.style.height).toBe('783px');
    expect(shelf.canvas.dataset.nativeRoomPresentation).toBe('true');expect(shelf.canvas.style.opacity).toBe('0');
    expect(contexts.get(shelf.canvas).copies).toHaveLength(0);
    expect(background.x).toBe(.25);expect(background.y).toBe(104.25);
  });
  it('uses a full-source five-argument base export at the original ceil dimensions and restores its owner',()=>{
    const background=shelf.getNativeRoomBackground(),expected=structuredClone(background.frame.texture.pixels);
    shelf.canvas.getContext('2d').getImageData();
    const raw=contexts.get(shelf.canvas);expect(shelf.canvas.width).toBe(590);expect(shelf.canvas.height).toBe(1175);
    expect(raw.copies).toHaveLength(1);expect(raw.copies[0].source).toBe(driver.renderer.domElement);
    expect(raw.copies[0].args).toEqual([0,0,590,1175]);expect(raw.frame).toEqual(expected);
    expect(driver.renderer.domElement.frame).toEqual(expected);expect(background.lease.isOwner()).toBe(true);
    expect(shelf.canvas.style.opacity).toBe('0');
  });
  it('keeps the complete physical overscan under the existing CSS clip and exports through a private ceil tile',()=>{
    fitted();const background=shelf.getNativeRoomBackground(),node=driver.renderer.domElement;
    expect(background.frame).toMatchObject({physical:true,width:649,height:1039,pixelWidth:973,pixelHeight:1558,ratio:1.5});
    expect(node.style.left).toBe('-128px');expect(node.style.top).toBe('-128px');
    expect(node.style.width).toBe('649px');expect(node.style.height).toBe('1039px');
    expect(node.parentElement.style.width).toBe('393px');expect(node.parentElement.style.height).toBe('783px');
    const fine=stage.querySelector('.ihr-bookshelf-inspection-snapshot');
    shelf.canvas.getContext('2d').getImageData();const copied=contexts.get(shelf.canvas).copies.at(-1);
    expect(copied.args).toEqual([192,192,590,1175,0,0,590,1175]);expect(copied.source).not.toBe(fine);
    expect(contexts.get(copied.source).copies[0].args).toEqual([0,0,974,1559]);
    expect(copied.source.width).toBe(0);expect(copied.source.height).toBe(0);
    expect(contexts.get(fine).copies).toHaveLength(0);expect(background.lease.isOwner()).toBe(true);
    expect(node.width).toBe(973);expect(node.height).toBe(1558);
  });
  it('restores the physical room after a foreign render and export resize the shared default framebuffer',()=>{
    const background=shelf.getNativeRoomBackground(),expected=structuredClone(background.frame.texture.pixels);
    const foreign=document.createElement('canvas'),raw=foreign.getContext('2d');
    withRendererPresentation(driver.renderer,null,()=>{
      driver.renderer.setPixelRatio(2);driver.renderer.setSize(393,844);
      driver.renderer.domElement.frame={foreign:true};raw.drawImage(driver.renderer.domElement,0,0);
    });
    expect(raw.frame).toEqual({foreign:true});expect(driver.renderer.domElement.frame).toEqual(expected);
    expect(driver.renderer.domElement.width).toBe(589);expect(driver.renderer.domElement.height).toBe(1174);
    expect(background.lease.isOwner()).toBe(true);expect(contexts.get(shelf.canvas).copies).toHaveLength(0);
  });
  it('uses the original visible 2D fallback when actual physical-buffer support is unavailable',()=>{
    driver.bufferSupported=false;shelf.invalidate();shelf.flush();
    expect(shelf.getNativeRoomBackground()).toBeNull();expect(shelf.canvas.dataset.nativeRoomPresentation).toBe('false');
    expect(shelf.canvas.style.opacity).toBe('');expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(contexts.get(shelf.canvas).copies.at(-1).args).toEqual([0,0,590,1175]);
  });
  it('keeps the original CSS inspection gesture and materializes each retained tile only when needed',()=>{
    fitted();const fine=stage.querySelector('.ihr-bookshelf-inspection-snapshot'),overview=stage.querySelector('.ihr-bookshelf-inspection-overview');
    const renders=shelf.canvas.dataset.snapshotRenderCount;
    shelf.setInspectionView({zoom:1.1,panX:0,panY:0},{moving:true,renderNow:true});
    expect(shelf.canvas.dataset.snapshotRenderCount).toBe(renders);
    expect(fine.style.display).toBe('block');expect(overview.style.display).toBe('block');
    expect(driver.renderer.domElement.isConnected).toBe(false);
    expect(contexts.get(fine).copies).toHaveLength(1);expect(contexts.get(overview).copies).toHaveLength(1);
    expect(contexts.get(overview).copies[0].args).toEqual([0,0,974,1559]);
    expect(contexts.get(fine).copies[0].source).toBe(overview);
    expect(contexts.get(fine).frame).toEqual(contexts.get(overview).frame);
  });
  it('rejects lost physical frames and restores through a fresh original scene draw and generation',()=>{
    const old=shelf.getNativeRoomBackground().frame,renderer=driver.renderer;
    driver.lost=true;renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    expect(shelf.getNativeRoomBackground()).toBeNull();
    driver.lost=false;renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    const restored=shelf.getNativeRoomBackground();expect(restored.frame.generation).not.toBe(old.generation);
    expect(restored.lease.isOwner()).toBe(true);expect(shelf.canvas.dataset.inspectionDirtySource).toBe('context-restored');
    expect(contexts.get(shelf.canvas).copies).toHaveLength(0);
  });
});
