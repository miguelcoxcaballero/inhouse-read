import {it,expect,vi} from 'vitest';
import * as native from '../../src/js/book-colors.js';
import * as reference from './helpers/reference-book-customization.js';
import {rustShelf,shelfWasm} from './helpers/rust-shelf-ready.js';
const outcome=(fn,...args)=>{try{return{value:fn(...args)}}catch(error){return{error:error.name}}};
it('preserves finish/default choices and every finite-position boundary',()=>{
 const values=[undefined,null,false,true,0,-0,NaN,'matte','satin','glossy','gold','silver','none','toString','__proto__','',{},new String('glossy'),Symbol('finish')];
 for(const value of values){expect(outcome(native.spineFinish,value)).toEqual(outcome(reference.spineFinish,value));for(const fallback of values)expect(outcome(native.surfaceFinish,value,fallback)).toEqual(outcome(reference.surfaceFinish,value,fallback));}
 for(const shelf of [-2,-0,0,1,1.2,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,'1',1n,null,undefined,true])for(const x of [-Infinity,-2,-0,0,.5,1,2,Infinity,NaN,'1',1n,null,undefined])expect(outcome(native.normalizeShelfPosition,{shelf,x})).toEqual(outcome(reference.normalizeShelfPosition,{shelf,x}));
});
it('keeps the complete appearance allow-list and UTF-16 values for nested metadata',()=>{
 const fields={shelfPosition:[null,{shelf:1,x:.4},{shelf:0,x:3},{}],spineColorOverride:[null,'#ABC','bad'],spineTextColor:[null,'#a1b2c3','bad'],spineFinish:['gold','silver','bad'],spineTextFinish:['silver','bad'],coverFinish:['glossy','satin','matte','bad'],pageEdgeFinish:['glossy','bad'],spineSurfaceFinish:['satin','bad'],coverRelief:[null,{},'unknown'],author:['Name',['A',{name:'B'}],{givenName:'First',familyName:'Last'},'a\ud800b'],spineEngraved:[true,false,'yes'],spineTitleOverride:['Edited','x'.repeat(119)+'😀','a\udc00b'],spineFontFamily:['Lora','DM Sans','Other'],spineFontSize:[1,20,99,NaN],spineAuthorFontSize:[1,12,99,Infinity]};
 const entries=Object.entries(fields);
 for(let n=0;n<500;n++){const book={content:new Blob(['never copy']),locator:{page:4},extra:'ignored'};for(let j=0;j<entries.length;j++){const[key,values]=entries[j];if((n+j)%5)book[key]=values[(n*7+j*3)%values.length];}expect(outcome(native.spineCustomization,book)).toEqual(outcome(reference.spineCustomization,book));}
 for(const value of [undefined,null,false,0,'',NaN,true,1,'book',Symbol('book'),Object.assign(Object.create({author:'Inherited',spineFinish:'gold'}),{spineTitleOverride:'Own'})])expect(outcome(native.spineCustomization,value)).toEqual(outcome(reference.spineCustomization,value));
});
it('retains repeated getter/relational coercion order, errors and native handle lifetimes',()=>{
 const position=run=>{const calls=[];let shelf=0,x=0;const value={get shelf(){calls.push('shelf:'+shelf);return ++shelf===2?{[Symbol.toPrimitive](hint){calls.push('coerce:'+hint);return 1n}}:1},get x(){calls.push('x:'+x++);return x===1?.5:2}};return{value:run(value),calls}};
 expect(position(native.normalizeShelfPosition)).toEqual(position(reference.normalizeShelfPosition));
 const trace=run=>{const calls=[];const data={shelfPosition:{shelf:1,x:.4},spineColorOverride:'#abc',spineTextColor:'#def',spineFinish:'gold',spineTextFinish:'silver',coverFinish:'glossy',coverRelief:null,pageEdgeFinish:'satin',spineSurfaceFinish:'matte',spineEngraved:true,spineTitleOverride:'Edited',author:{name:'Writer'},spineFontFamily:'Lora',spineFontSize:22,spineAuthorFontSize:12};const book=new Proxy(data,{get(target,key){calls.push('get:'+String(key));return Reflect.get(target,key)},has(target,key){calls.push('has:'+String(key));return Reflect.has(target,key)}});return{value:run(book),calls}};
 expect(trace(native.spineCustomization)).toEqual(trace(reference.spineCustomization));
 native.spineCustomization({author:'Warmup',coverRelief:null});const count=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks(),bytes=shelfWasm.memory.buffer.byteLength;
 for(let n=0;n<100;n++){
  expect(native.normalizeShelfPosition({shelf:1,x:2})).toEqual({shelf:1,x:1});
  let x=0;expect(()=>native.normalizeShelfPosition({shelf:1,get x(){return ++x===1?.5:1n}})).toThrow();
  expect(()=>native.spineCustomization({get spineTitleOverride(){throw Error('getter')}})).toThrow('getter');
 }
 expect(rustShelf.shelf_live_handles()).toBe(count);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);expect(shelfWasm.memory.buffer.byteLength).toBe(bytes);
});
it('uses the reader module without loading Shelf for stored appearance',async()=>{
 const {rustUI}=await import('./helpers/rust-ui-ready.js');const loader=await import('../../src/js/rust-shelf.js');const hide=vi.spyOn(loader,'getRustShelf').mockReturnValue(null),require=vi.spyOn(loader,'needRustShelf');
 try{expect(native.spineCustomization({author:{name:'Writer'},spineFinish:'gold',coverFinish:'glossy',shelfPosition:{shelf:0,x:-1}})).toEqual({shelfPosition:{shelf:0,x:0},spineFinish:'gold',coverFinish:'glossy',author:'Writer'});expect(native.surfaceFinish('glossy')).toBe('glossy');expect(require).not.toHaveBeenCalled();expect(rustUI.book_shelf_position({shelf:2,x:1})).toEqual({shelf:2,x:1});}finally{hide.mockRestore();require.mockRestore();}
});
