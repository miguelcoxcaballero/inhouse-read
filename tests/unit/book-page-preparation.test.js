import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {bookView} from '../../src/js/book-model.js';
const metrics=vi.hoisted(()=>({renders:0}));
vi.mock('three',async original=>{
 const THREE=await original();
 class Renderer{
  constructor(){this.domElement=document.createElement('canvas');this.shadowMap={};this.info={programs:[]};this.capabilities={getMaxAnisotropy:()=>1};this.size=new THREE.Vector2();this.ratio=1;}
  getSize(target){return target.copy(this.size);}setSize(w,h){this.size.set(w,h);}getPixelRatio(){return this.ratio;}setPixelRatio(v){this.ratio=v;}
  compile(){}render(){metrics.renders++;}
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
function make(deferDraw=false){return view=bookView(host,{id:'batch',title:'A Book',author:'Reader',format:'PDF'},
 {color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40},
 {width:132,height:200,thickness:40,viewportWidth:390,viewportHeight:844,centerX:195,centerY:350,initialPose:pose,deferDraw});}
function snapshot(){const source=document.createElement('canvas');source.width=132;source.height=200;return{source,width:132,height:200,engine:'pdf',sourceType:'pdf-original',text:'Actual page',location:{locator:3},background:'#ffffff'};}
describe('book page preparation paints once',()=>{
 it('prepares the model, snapshot and projection before its first aligned framebuffer',async()=>{
  make(true);await view.ready;expect(metrics.renders).toBe(0);
  expect(view.setPageSnapshot(snapshot(),{redraw:false})).toBe(true);
  view.draw({...pose,scale:.7},{redraw:false});expect(metrics.renders).toBe(0);
  expect(view.getPose().scale).toBe(.7);expect(view.canvas.dataset.pageText).toBe('Actual page');
  expect(view.alignToPage({left:0,top:0,width:390,height:844})).toBe(true);
  expect(metrics.renders).toBe(1);expect(view.canvas.dataset.coverOpen).toBe('1');
 });
 it('updates a visible page with one framebuffer, including the model invalidation',()=>{
  make();const before=metrics.renders;expect(view.setPageSnapshot(snapshot())).toBe(true);expect(metrics.renders-before).toBe(1);
 });
 it('prepares a retained view without changing the one-argument snapshot contract',()=>{
  make();const before=metrics.renders;view.deferDrawing();
  expect(view.setPageSnapshot(snapshot())).toBe(true);expect(metrics.renders).toBe(before);
  view.draw({...pose,scale:.7},{redraw:false});expect(metrics.renders).toBe(before);
  expect(view.alignToPage({left:0,top:0,width:390,height:844})).toBe(true);expect(metrics.renders).toBe(before+1);
 });
 it('can prepare a new pose without losing the displayed-frame cue, then paint it normally',()=>{
  make();const before=metrics.renders;const displayed=view.canvas.dataset.angle;
  view.draw({...pose,angle:65},{redraw:false});expect(metrics.renders).toBe(before);expect(view.getPose().angle).toBe(65);
  expect(view.canvas.dataset.angle).toBe(displayed);view.draw(view.getPose());expect(metrics.renders).toBe(before+1);expect(view.canvas.dataset.angle).toBe('65');
 });
});
