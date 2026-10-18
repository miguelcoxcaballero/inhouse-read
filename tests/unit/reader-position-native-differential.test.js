// @vitest-environment node
import {it,expect} from 'vitest';
import * as reference from './helpers/reference-persistable-position.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const numbers=[undefined,null,false,true,0,-0,1,-1,.5,1.5,NaN,Infinity,-Infinity,Number.MIN_VALUE,Number.MAX_VALUE,2**53-1,2**53,1e20,'0','1','',{},[],new Number(1)];
const strings=[undefined,null,'',' ','\ufeff','\u2003','epubcfi(/6/8!/4/2)',' \ufeffcfi:📖:\ud800 ',new String('cfi'),0,{}];
const kinds=[undefined,null,'cfi','pdf-page','other',new String('pdf-page')];
for(const seed of [31,97,151,239])it(`matches committed anchors and relocations over a typed corpus ${seed}`,()=>{
 let random=seed;const choose=a=>{random^=random<<13;random^=random>>>17;random^=random<<5;return a[(random>>>0)%a.length]};
 for(let n=0;n<2500;n++){
  const kind=choose(kinds),location={fraction:choose(numbers),locator:{kind,value:kind==='cfi'?choose(strings):choose(numbers),textOffset:choose(numbers)}};
  expect(rustShelf.reader_persistable_position(location)).toEqual(reference.persistablePosition(location));
  const relocation={fraction:choose(numbers),cfi:choose(strings),index:choose(numbers),textOffset:choose(numbers)},engine=choose(['pdf','foliate',null,undefined,'PDF']);
  expect(rustShelf.reader_persistable_relocation(relocation,engine)).toEqual(reference.persistableRelocation(relocation,engine));
 }
});
it('keeps UTF-16 CFIs exact, normalizes negative zero and omits an empty offset',()=>{
 const value=' \ufeffepubcfi:📖:\ud800 ',result=rustShelf.reader_persistable_position({fraction:-0,locator:{kind:'cfi',value}});
 expect(result.locator.value).toBe(value);expect(Object.is(result.fraction,0)).toBe(true);
 expect(rustShelf.reader_persistable_position({fraction:.4,locator:{kind:'pdf-page',value:1,textOffset:-0}})).toEqual({fraction:.4,locator:{kind:'pdf-page',value:1}});
});
it('rejects missing or primitive locations without inventing an anchor',()=>{
 for(const value of [undefined,null,false,true,0,-0,1,1n,Symbol('location'),'text',[],{}])expect(rustShelf.reader_persistable_position(value)).toEqual(reference.persistablePosition(value));
});
it('propagates the original getter error through the native boundary',()=>{
 const error=Error('fraction getter'),location={get fraction(){throw error}};
 for(const use of [reference.persistablePosition,rustShelf.reader_persistable_position]){let caught;try{use(location)}catch(value){caught=value}expect(caught).toBe(error)}
});
it('uses the same guard in the UI-only reader module',async()=>{
 const{rustUI}=await import('./helpers/rust-ui-ready.js');const location={fraction:1.1,locator:{kind:'pdf-page',value:3,textOffset:11}};
 expect(rustUI.reader_persistable_position(location)).toEqual(reference.persistablePosition(location));
});
it('releases temporary native handles after a long series of validation calls',()=>{
 const sample={fraction:.4,locator:{kind:'cfi',value:'epubcfi(/6/4)'}};rustShelf.reader_persistable_position(sample);const before=rustShelf.shelf_live_handles();
 for(let n=0;n<1000;n++)rustShelf.reader_persistable_position(sample);expect(rustShelf.shelf_live_handles()).toBe(before);
});
