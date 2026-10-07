// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {paddedBookFrameSize} from '../../src/js/book-frame-padding.js';
const frame={width:384,height:192},previous={x:390,y:320},physical={width:780,height:640};

describe('bounded empty rows for the native book',()=>{
 it('keeps the original small buffer through bookmark, closing cover and flight',()=>{
  expect(paddedBookFrameSize(frame,previous,2,physical,true)).toEqual({width:390,height:320});
  expect(paddedBookFrameSize({...frame,height:320},previous,2,physical,true)).toEqual({width:390,height:320});
 });
 it.each([
  ['disabled',frame,previous,2,physical,false],
  ['fractional DPR',frame,previous,1.5,{width:585,height:480},true],
  ['too tall',{...frame,height:320},{x:390,y:385},2,{width:780,height:770},true],
  ['too much empty height',{...frame,height:191},previous,2,physical,true],
  ['too much empty width',frame,{x:401,y:320},2,{width:802,height:640},true],
  ['width growth',frame,{x:383,y:320},2,{width:766,height:640},true],
  ['height growth',{...frame,height:321},previous,2,physical,true],
  ['fractional requested size',{...frame,height:192.5},previous,2,physical,true],
  ['fractional previous size',frame,{x:390,y:320.5},2,{width:780,height:641},true],
  ['stale physical width',frame,previous,2,{width:781,height:640},true],
  ['stale physical height',frame,previous,2,{width:780,height:641},true],
  ['uninitialised',frame,{x:0,y:0},2,{width:0,height:0},true]
 ])('uses the exact requested allocation for %s',(_name,wanted,old,ratio,pixels,allowed)=>{
  expect(paddedBookFrameSize(wanted,old,ratio,pixels,allowed)).toEqual({width:wanted.width,height:wanted.height});
 });
 it('retains only the old horizontal margin when heights match',()=>{
  expect(paddedBookFrameSize({...frame,height:320},previous,2,physical,true)).toEqual({width:390,height:320});
 });
 it('bounds the reservation at384 rows and128 empty rows',()=>{
  expect(paddedBookFrameSize({width:384,height:256},{x:390,y:384},3,{width:1170,height:1152},true)).toEqual({width:390,height:384});
 });
});

const source=()=>readFileSync('src/js/book-model.js','utf8');
function body(name){return source().match(new RegExp('function '+name+'\\([^\\n]*\\) \\{([\\s\\S]*?)\\n  \\}'))[1];}
describe('production native padding coordinates',()=>{
 it('positions the original viewport above its blank upper rows without rescaling it',()=>{
  const parent={style:{},getBoundingClientRect:()=>({left:10,top:20}),append:vi.fn()};
  const canvas={parentElement:{parentElement:parent},style:{},getBoundingClientRect:()=>({left:30,top:50,width:780,height:1266})};
  const node={setAttribute:vi.fn(),style:{},parentNode:parent};
  const fn=new Function('canvas','gpu','viewportWidth','viewportHeight','getComputedStyle','frame','let live=false;'+body('positionPresentation')+';return live;');
  expect(fn(canvas,{domElement:node},390,844,()=>({position:'relative'}),{x:7,y:200,width:384,height:192,presentationWidth:390,presentationHeight:320,paddingTop:128})).toBe(true);
  expect(node.style.cssText).toContain('left:34px');expect(node.style.cssText).toContain('top:138px');
  expect(node.style.cssText).toContain('width:780px');expect(node.style.cssText).toContain('height:480px');
 });
 it.each([false,true])('exports the same full page with vertical padding=%s',padded=>{
  const context={clearRect:vi.fn(),drawImage:vi.fn()},camera={},gpu={domElement:{}},frame={x:5,y:100,camera:{},paddingTop:padded?128:0};
  const call=new Function('context','canvas','gpu','camera','pixelRatio','frame','copyRectangle','current','full','let copiedRectangle=null,snapshotDirty=true;'+body('copyFrame'));
  call(context,{width:780,height:1688},gpu,camera,2,frame,vi.fn(),{},true);
  expect(context.drawImage).toHaveBeenCalledWith(gpu.domElement,10,(100-(padded?128:0))*2);
 });
 it('copies a partial snapshot from the rendered lower viewport, not its transparent padding',()=>{
  const context={clearRect:vi.fn(),drawImage:vi.fn()},gpu={domElement:{}},rect={x:20,y:250,width:40,height:60};
  const call=new Function('context','canvas','gpu','camera','pixelRatio','frame','copyRectangle','current','full','let copiedRectangle=null,snapshotDirty=true;'+body('copyFrame'));
  call(context,{width:780,height:1688},gpu,{},2,{x:5,y:100,camera:{},paddingTop:128},()=>rect,{},false);
  expect(context.drawImage).toHaveBeenCalledWith(gpu.domElement,10,306,40,60,20,250,40,60);
 });
});
