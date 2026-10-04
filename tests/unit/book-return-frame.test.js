import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {bookView} from '../../src/js/book-model.js';
const metrics=vi.hoisted(()=>({renders:0,frame:null}));
vi.mock('three',async original=>{
 const THREE=await original();
 class Renderer{
  constructor(){this.domElement=document.createElement('canvas');this.shadowMap={};this.info={programs:[]};this.capabilities={getMaxAnisotropy:()=>1};this.size=new THREE.Vector2();this.ratio=1;}
  getSize(target){return target.copy(this.size);}setSize(w,h){this.size.set(w,h);}getPixelRatio(){return this.ratio;}setPixelRatio(v){this.ratio=v;}
  compile(){}render(scene,camera){metrics.renders++;metrics.frame={size:this.size.toArray(),ratio:this.ratio,camera:camera.clone()};}
 }
 class PMREM{fromScene(){return{texture:new THREE.Texture()};}dispose(){}}
 return{...THREE,WebGLRenderer:Renderer,PMREMGenerator:PMREM};
});
let view,host,context;
beforeEach(()=>{
 metrics.renders=0;vi.stubGlobal('WebGLRenderingContext',function(){});
 context=new Proxy({measureText:t=>({width:String(t).length*16}),createLinearGradient:()=>({addColorStop(){}}),getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(o,k)=>o[k]??(()=>{})});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);host=document.createElement('div');document.body.append(host);
});
afterEach(()=>{view?.dispose();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
const pose={x:0,y:0,scale:1,angle:0,pitch:0,coverOpen:1,bookmarkWithdraw:1};
function make(deferDraw=false,frameOptions={}){return view=bookView(host,{id:'batch',title:'A Book',author:'Reader',format:'PDF'},
 {color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40},
 {width:132,height:200,thickness:40,viewportWidth:390,viewportHeight:844,centerX:195,centerY:350,initialPose:pose,deferDraw,...frameOptions});}
function snapshot(){const source=document.createElement('canvas');source.width=132;source.height=200;return{source,width:132,height:200,engine:'pdf',sourceType:'pdf-original',text:'Actual page',location:{locator:3},background:'#ffffff'};}
describe('pixel-aligned return camera window',()=>{
 it('reduces the GPU window while keeping the original output canvas and DPR',()=>{
  vi.stubGlobal('devicePixelRatio',2); make(false,{compactReturnFrame:true});
  expect(metrics.frame.size[1]).toBeLessThan(844); expect(view.canvas.width).toBe(780);
  expect(view.canvas.height).toBe(1688); expect(metrics.frame.ratio).toBe(2);
 });
 it('projects the same world coordinates at the same physical pixel positions',()=>{
  make(false); const full=metrics.frame.camera; view.setCompactReturnFrame(true); view.draw(view.getPose());
  const cropped=metrics.frame.camera,offset=cropped.view;
  expect(offset).toBeTruthy(); expect(cropped.position.toArray()).toEqual(full.position.toArray());
  for(const point of [[0,0,0],[-80,100,12],[70,-80,-25]]){
   const project=(camera)=>new full.position.constructor(...point).project(camera);
   const a=project(full),b=project(cropped);
   expect(offset.offsetX+(b.x+1)*offset.width/2).toBeCloseTo((a.x+1)*390/2,7);
   expect(offset.offsetY+(1-b.y)*offset.height/2).toBeCloseTo((1-a.y)*844/2,7);
  }
 });
 it('keeps the complete viewport for the initial zoom',()=>{
  make(false,{compactReturnFrame:true});view.draw({...pose,scale:1.2});
  expect(metrics.frame.size).toEqual([390,844]);expect(metrics.frame.camera.view?.enabled || false).toBe(false);
 });
 it('keeps the complete viewport at fractional DPR',()=>{
  vi.stubGlobal('devicePixelRatio',1.5);make(false,{compactReturnFrame:true});
  expect(metrics.frame.size).toEqual([390,844]);expect(metrics.frame.ratio).toBe(1.5);
 });
 it('can return to a complete framebuffer without changing pose or model state',()=>{
  make(false,{compactReturnFrame:true});const before=view.getPose();view.setCompactReturnFrame(false);view.draw(before);
  expect(metrics.frame.size).toEqual([390,844]);expect(view.getPose()).toEqual(before);
  expect(view.canvas.dataset.coverOpen).toBe('1');expect(view.canvas.dataset.renderer).toBe('three-mesh');
 });
 it('falls back to the complete frame for a noninteger viewport',()=>{
  make(false,{compactReturnFrame:true,viewportWidth:390.5}); expect(metrics.frame.size).toEqual([390.5,844]);
 });
});
