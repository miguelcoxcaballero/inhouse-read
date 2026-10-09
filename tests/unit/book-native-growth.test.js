import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {configureNativeRendererSize} from '../../src/js/native-renderer-size.js';
import {paddedBookFrameSize} from '../../src/js/book-frame-padding.js';

afterEach(()=>vi.restoreAllMocks());
function productionConfigure(){
  const source=readFileSync('src/js/book-model.js','utf8');
  const body=source.match(/function configureFrame\(frame\) \{([\s\S]*?)\n  \}/)[1];
  return new Function('gpu','rendererSize','pixelRatio','directEnabled','compactReturnFrame','camera','paddedBookFrameSize','configureNativeRendererSize','frame',body);
}
function driver(width,height){
  const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
  const writes=[];
  for(const axis of ['width','height']){
    const original=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,axis).set;
    vi.spyOn(HTMLCanvasElement.prototype,axis,'set').mockImplementation(function(value){original.call(this,value);if(this===canvas)writes.push([axis,value,canvas.width,canvas.height]);});
  }
  return {domElement:canvas,writes,size:new THREE.Vector2(width,height),ratio:2,isWebGLRenderer:true,autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,xr:{isPresenting:false},
    getRenderTarget:()=>null,getScissorTest:()=>false,getPixelRatio(){return this.ratio;},getSize(out){return out.copy(this.size);},
    setSize(w,h){this.size.set(w,h);canvas.width=Math.floor(w*this.ratio);canvas.height=Math.floor(h*this.ratio);},
    setPixelRatio(r){this.ratio=r;this.setSize(this.size.x,this.size.y);},setDrawingBufferSize(w,h,r){this.ratio=r;this.setSize(w,h);},setViewport(...viewport){this.viewport=viewport;}};
}
function configure(gpu,width,height){const camera={};productionConfigure()(gpu,new THREE.Vector2(),2,true,true,camera,paddedBookFrameSize,configureNativeRendererSize,{width,height,camera});}
describe('selected book bounded framebuffer growth',()=>{
  it('grows both axes without resetting to an empty frame',()=>{
    const gpu=driver(128,320);configure(gpu,320,448);
    expect(gpu.writes.map(w=>w.slice(0,2))).toEqual([['width',640],['height',896]]);
    expect(gpu.writes.every(w=>w[2]*w[3]<=640*896)).toBe(true);
    expect(gpu.viewport).toEqual([0,0,320,448]);expect([gpu.domElement.width,gpu.domElement.height]).toEqual([640,896]);
    expect(Object.hasOwn(gpu.domElement,'width')).toBe(false);expect(Object.hasOwn(gpu.domElement,'height')).toBe(false);
  });
  it('retains zero-height staging when one axis grows and the other shrinks',()=>{
    const gpu=driver(320,448);configure(gpu,390,192);
    expect(gpu.writes.map(w=>w.slice(0,2))).toEqual([['height',0],['width',780],['height',384]]);
    expect(gpu.viewport).toEqual([0,0,390,192]);expect([gpu.domElement.width,gpu.domElement.height]).toEqual([780,384]);
  });
  it('keeps a one-axis resize and does no reset for the same frame',()=>{
    const gpu=driver(390,192);configure(gpu,390,256);configure(gpu,390,256);
    expect(gpu.writes.map(w=>w.slice(0,2))).toEqual([['height',512]]);expect(gpu.viewport).toEqual([0,0,390,256]);
  });
});
