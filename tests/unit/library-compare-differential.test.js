// Copy into tests/unit only in the 267 worktree, after its native implementation is built.
import {expect,it} from 'vitest';
import * as native from '../../src/js/library-store.js';
import * as original from './helpers/reference-library-store.js';
import {rustShelf,shelfWasm} from './helpers/rust-shelf-ready.js';
const result=(run,...args)=>{try{return{value:run(...args)}}catch(error){return{error:error.name}}};
it('matches complete equality decisions for typed values, nested metadata, sparse lists and cyclic clones',()=>{
 const samples=[undefined,null,false,0,-0,NaN,1,'x','x\ud800',12n,new Date(1),new Date(NaN),new Blob(['x']),new Blob(['y']),new Blob(['xx']),new Map([[1,2]]),Object.create(null),[1,{a:2}],{path:[1,2],locator:{a:'x'}},Object.assign(Object.create({inherited:true}),{a:1})];
 for(const a of samples)for(const b of samples)expect(result(native.sameBookRecords,[{a}],[{a:b}])).toEqual(result(original.sameBookRecords,[{a}],[{a:b}]));
 for(const a of [[],[,,],Array(3),[1,,3]])for(const b of [[],[,,],Array(3),[1,,3]])expect(result(native.sameBookRecords,a,b)).toEqual(result(original.sameBookRecords,a,b));
 const a={},b={};a.self=a;b.self=b;expect(result(native.sameBookRecords,[a],[b])).toEqual(result(original.sameBookRecords,[a],[b]));
});
function traceEquality(run){
 const calls=[];
 const blob=label=>({get[Symbol.toStringTag](){calls.push(label+':tag');return'Blob';},get type(){calls.push(label+':type');return'text/plain';},get size(){calls.push(label+':size');return 1;},get lastModified(){calls.push(label+':time');return undefined;}});
 const wrap=(value,label)=>new Proxy(value,{ownKeys(target){calls.push(label+':keys');return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){calls.push(label+':descriptor:'+String(key));return Reflect.getOwnPropertyDescriptor(target,key);},has(target,key){calls.push(label+':has:'+String(key));return Reflect.has(target,key);},get(target,key,receiver){calls.push(label+':get:'+String(key));return Reflect.get(target,key,receiver);}});
 return{value:run(wrap([{path:{a:1},file:blob('a')}],'previous'),wrap([{path:{a:1},file:blob('b')}],'next')),calls};
}
it('retains SDK every/sort evaluation order and all metadata getter calls',()=>{
 expect(traceEquality(native.sameBookRecords)).toEqual(traceEquality(original.sameBookRecords));
 const trace=run=>{
  const calls=[],array=[20,5,10,NaN,10].map((value,i)=>({id:i,get lastOpenedAt(){calls.push('read:'+i);return{[Symbol.toPrimitive](hint){calls.push('coerce:'+i+':'+hint);return value;}};}}));
  const sorted=run(array);return{same:sorted===array,ids:sorted.map(x=>x.id),calls};
 };
 expect(trace(native.recentFirst)).toEqual(trace(original.recentFirst));
 for(const values of [[1n,2n],[1n,2],[undefined,null,NaN,'3',new Date(1)],[-0,0,Infinity,-Infinity]]){
  const run=fn=>{const records=values.map((lastOpenedAt,id)=>({lastOpenedAt,id}));const value=result(fn,records);return value.error?value:{ids:value.value.map(x=>x.id)};};
  expect(run(native.recentFirst)).toEqual(run(original.recentFirst));
 }
});
it('does not retain native handles during successful comparisons or thrown getters',()=>{
 const make=()=>[{id:'book',locator:{path:[1,2]},file:new Blob(['x'])}];
 native.sameBookRecords(make(),make());const count=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks(),bytes=shelfWasm.memory.buffer.byteLength;
 for(let n=0;n<200;n++){
  expect(native.sameBookRecords(make(),make())).toBe(true);
  const a={get title(){throw Error('getter');}};expect(()=>native.sameBookRecords([a],[{title:'x'}])).toThrow('getter');
 }
 expect(rustShelf.shelf_live_handles()).toBe(count);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);expect(shelfWasm.memory.buffer.byteLength).toBe(bytes);
});
