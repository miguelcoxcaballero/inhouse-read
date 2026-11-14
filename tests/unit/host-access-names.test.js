// @vitest-environment node
// rust-ui/src/host.rs reads, writes and calls by a literal name in one visit to the host, which keeps
// the names. Through a real user of it (the lamp studio's frame, catalog_studio.rs): the names take no
// handle of the module, and what a missing object, a missing method, a throwing getter and a write to
// something that is not an object did before is what they do now.
import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';

const state=(over={})=>({kind:2,frame:0,disposed:false,active:true,drawable:true,pending:false,building:0,shown:true,dirty:false,model:{},render(){},
 host:{retint:()=>0,draw(){}},...over});
it('keeps no handle for the names it uses, however often',()=>{
 rust.studio_render(state());const before=rust.shelf_live_handles();
 for(let i=0;i<50;i++)rust.studio_render(state());
 expect(rust.shelf_live_handles()).toBe(before);
});
it('fails as the engine does on a missing object or method and reads a throwing getter as undefined',()=>{
 globalThis.requestAnimationFrame??=()=>1;
 expect(()=>rust.studio_render(null)).toThrow(TypeError);
 expect(()=>rust.studio_render(state({host:undefined}))).toThrow("Cannot read properties of undefined (reading 'retint')");
 expect(()=>rust.studio_render(state({host:{}}))).toThrow('retint is not a function');
 expect(()=>rust.studio_render(state({host:{retint:7}}))).toThrow('retint is not a function');
 const calls=[],thrower=state({host:{retint(now){calls.push(this===thrower.host,typeof now);return 2;},draw(model){calls.push(model===thrower.model);}}});
 Object.defineProperty(thrower,'disposed',{get(){throw Error('getter');}});
 rust.studio_render(thrower);
 expect(calls).toEqual([true,'number',true]);expect(thrower.dirty).toBe(false);
 const frames=[],easing=state({render(){},host:{retint:()=>3,draw(){}}}),real=globalThis.requestAnimationFrame;
 globalThis.requestAnimationFrame=function(callback){frames.push(this===globalThis,callback===easing.render);return 9;};
 try{rust.studio_render(easing);expect(frames).toEqual([true,true]);expect(easing.frame).toBe(9);
  globalThis.requestAnimationFrame=undefined;easing.frame=0;
  expect(()=>rust.studio_render(easing)).toThrow('requestAnimationFrame is not a function');
 }finally{globalThis.requestAnimationFrame=real;}
});
