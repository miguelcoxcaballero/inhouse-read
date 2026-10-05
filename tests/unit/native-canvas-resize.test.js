import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { withNativeCanvasResize } from '../../src/js/native-canvas-resize.js';
import { configureNativeRendererSize } from '../../src/js/native-renderer-size.js';

afterEach(() => vi.restoreAllMocks());
function driver(width=390,height=192,ratio=2) {
  const canvas=document.createElement('canvas');canvas.width=width*ratio;canvas.height=height*ratio;
  const writes=[];
  for(const axis of ['width','height']) {
    const original=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,axis).set;
    vi.spyOn(HTMLCanvasElement.prototype,axis,'set').mockImplementation(function(value) {
      if(this===canvas)writes.push([axis,value]);return original.call(this,value);
    });
  }
  return {domElement:canvas,isWebGLRenderer:true,autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,xr:{isPresenting:false},writes,
    size:new THREE.Vector2(width,height),ratio,viewport:[0,0,width*ratio,height*ratio],
    getScissorTest(){return false;},getRenderTarget(){return null;},
    getPixelRatio(){return this.ratio;},getSize(target){return target.copy(this.size);},
    setPixelRatio(value){this.ratio=value;this.setSize(this.size.x,this.size.y,false);},
    setSize(w,h){if(this.xr.isPresenting)return;this.size.set(w,h);
      canvas.width=Math.floor(w*this.ratio);canvas.height=Math.floor(h*this.ratio);
      this.viewport=[0,0,w*this.ratio,h*this.ratio].map(Math.round);},
    setDrawingBufferSize(w,h,r){this.ratio=r;this.setSize(w,h,false);}
  };
}
const configure=(renderer,width,height,ratio=2,native=true,enabled=true)=>
  configureNativeRendererSize(renderer,width,height,ratio,new THREE.Vector2(),native,enabled);
const restored=canvas=>{expect(Object.hasOwn(canvas,'width')).toBe(false);expect(Object.hasOwn(canvas,'height')).toBe(false);};

describe('native book canvas skips unchanged physical dimensions only during resize',()=>{
  it('changes only height through the original Three size/viewport API',()=>{
    const r=driver();configure(r,390,256);
    expect(r.writes).toEqual([['height',512]]);expect(r.size.toArray()).toEqual([390,256]);
    expect([r.domElement.width,r.domElement.height]).toEqual([780,512]);
    expect(r.viewport).toEqual([0,0,780,512]);restored(r.domElement);
  });
  it('changes only width and keeps the same native height',()=>{
    const r=driver();configure(r,393,192);
    expect(r.writes).toEqual([['width',786]]);expect(r.size.toArray()).toEqual([393,192]);
    expect(r.viewport).toEqual([0,0,786,384]);restored(r.domElement);
  });
  it('preserves both changed dimensions and pixel ratio during an atomic resize',()=>{
    const r=driver();configure(r,393,320,1.5);
    expect(r.writes).toEqual([['width',589],['height',480]]);
    expect(r.ratio).toBe(1.5);expect(r.size.toArray()).toEqual([393,320]);restored(r.domElement);
  });
  it('keeps physical rounding when fractional logical sizes resolve to the same native width',()=>{
    const r=driver();configure(r,390.25,256);
    expect(r.writes).toEqual([['height',512]]);expect(r.size.toArray()).toEqual([390.25,256]);
    expect(r.viewport).toEqual([0,0,781,512]);restored(r.domElement);
  });
  it('keeps both native resets when logical changes leave both physical dimensions identical',()=>{
    const r=driver();configure(r,390.25,192.25);
    expect(r.writes).toEqual([['width',780],['height',384]]);
    expect(r.size.toArray()).toEqual([390.25,192.25]);restored(r.domElement);
  });
  it('retains a ratio-only resize and both native dimensions',()=>{
    const r=driver();configure(r,390,192,1.5);
    expect(r.writes).toEqual([['width',585],['height',288]]);expect(r.ratio).toBe(1.5);restored(r.domElement);
  });
  it('does no resize work when logical dimensions and ratio are unchanged',()=>{
    const r=driver();configure(r,390,192);expect(r.writes).toEqual([]);restored(r.domElement);
  });
  it.each(['legacy','disabled','manual-clear','partial-color','partial-depth','partial-stencil','scissor','active-target','unknown-renderer'])('preserves original assignments for %s',mode=>{
    const r=driver();if(mode==='manual-clear')r.autoClear=false;if(mode==='unknown-renderer')r.isWebGLRenderer=false;
    if(mode==='partial-color')r.autoClearColor=false;if(mode==='partial-depth')r.autoClearDepth=false;
    if(mode==='partial-stencil')r.autoClearStencil=false;
    if(mode==='scissor')r.getScissorTest=()=>true;if(mode==='active-target')r.getRenderTarget=()=>({});
    configure(r,390,256,2,mode!=='legacy',mode!=='disabled');
    expect(r.writes).toEqual([['width',780],['height',512]]);restored(r.domElement);
  });
  it('preserves the XR size rejection',()=>{
    const r=driver();r.xr.isPresenting=true;configure(r,390,256);
    expect(r.writes).toEqual([]);expect(r.size.toArray()).toEqual([390,192]);restored(r.domElement);
  });
  it('does not suppress explicit same-width clears outside the resize scope',()=>{
    const r=driver();configure(r,390,256);r.writes.length=0;r.domElement.width=780;
    expect(r.writes).toEqual([['width',780]]);restored(r.domElement);
  });
  it('restores native accessors and propagates the original operation error',()=>{
    const r=driver(),error=new Error('driver failed');
    expect(()=>withNativeCanvasResize(r,()=>{r.domElement.height=512;throw error;},{width:780,height:512})).toThrow(error);
    restored(r.domElement);r.domElement.width=780;expect(r.writes).toEqual([['height',512],['width',780]]);
  });
  it('preserves existing own-property instrumentation',()=>{
    const r=driver(),original=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width');
    Object.defineProperty(r.domElement,'width',{...original,configurable:true});
    const before=Object.getOwnPropertyDescriptor(r.domElement,'width');configure(r,390,256);
    expect(r.writes).toEqual([['width',780],['height',512]]);
    expect(Object.getOwnPropertyDescriptor(r.domElement,'width')).toEqual(before);
    expect(Object.hasOwn(r.domElement,'height')).toBe(false);
  });
  it('falls back once when the canvas cannot accept scoped accessors',()=>{
    const r=driver();Object.preventExtensions(r.domElement);configure(r,390,256);
    expect(r.writes).toEqual([['width',780],['height',512]]);restored(r.domElement);
  });
  it('preserves WebIDL coercion for non-normalised explicit values',()=>{
    const r=driver();withNativeCanvasResize(r,()=>{r.domElement.width='780';r.domElement.height=384.25;},{width:780,height:512});
    expect(r.writes).toEqual([['width','780'],['height',384.25]]);restored(r.domElement);
  });
  it('keeps operation results and forwards non-canvas drivers untouched',()=>{
    const canvas={width:780,height:384},operation=vi.fn(()=>23);
    expect(withNativeCanvasResize({domElement:canvas,isWebGLRenderer:true,autoClear:true},operation)).toBe(23);
    expect(operation).toHaveBeenCalledOnce();expect(canvas).toEqual({width:780,height:384});
  });
});
