import {it,expect,vi} from 'vitest';
import * as native from '../../src/js/book-title.js';
import * as reference from './helpers/reference-book-title.js';
import {rustShelf,shelfWasm} from './helpers/rust-shelf-ready.js';
const result=(fn,...args)=>{try{return{value:fn(...args)}}catch(error){return{error:error.name,message:error.message}}};
it('preserves the complete title rules over multilingual, long and malformed UTF-16 metadata',()=>{
 const words=['de','the','NASA','iPhone','AI','Short','un','LE','Café','東京','İstanbul','ДОБРО','العربية','हिन्दी','𝒜','a\ud800b','\udc00','e\u0301','Ⅳ','１２３','\n','foo/bar','foo_bar','guide:','ONE!','...','…'];
 const values=[undefined,null,'',' ',0,-0,NaN,Infinity,true,123n,Symbol('text'),...words,'a'.repeat(90),'word '.repeat(35),'Main Title Is Long: '+ 'a'.repeat(100)];
 for(let i=0;i<500;i++)values.push(Array.from({length:1+i%24},(_,j)=>words[(i*11+j*7)%words.length]).join(i%2?' ':'_')+['.pdf','.EPUB','','...','…'][i%5]);
 for(const value of values)for(const fallback of ['', 'fallback_title.epub',null])expect(result(native.normalizeBookTitle,value,fallback)).toEqual(result(reference.normalizeBookTitle,value,fallback));
});
it('preserves nested author selection, deduplication, limits and display names without replacing surrogates',()=>{
 const values=[undefined,null,false,0,NaN,Infinity,15n,Symbol('name'),'', '  Úrsula\nLe Guin  ', '[object Object]', ['a','a',{name:'b'},['c',null]],Array(3),Object.assign(Array(3),{1:'Name'}),{},new Date(1),{name:'',displayName:'Display'}, {name:{author:['first','second']}},{givenName:'Terry',familyName:'Pratchett'},{givenName:null,firstName:'First',familyName:'',lastName:'Ignored'},'a'.repeat(119)+'😀','a\ud800b', {name:'a\udc00b'}, {givenName:{firstName:'First'},familyName:['Last','Other']}];
 for(const value of values)expect(result(native.normalizeBookAuthor,value)).toEqual(result(reference.normalizeBookAuthor,value));
 for(const book of [undefined,null,{},...values.map(value=>({title:value})),{title:'Original',spineTitleOverride:'  a\ud800b \n name '},{title:12,spineTitleOverride:0}])expect(result(native.displayBookTitle,book)).toEqual(result(reference.displayBookTitle,book));
 const deep={name:'End'};let nested=deep;for(let n=0;n<1500;n++)nested={creator:nested};expect(native.normalizeBookAuthor(nested)).toBe(reference.normalizeBookAuthor(nested));
});
it('keeps getter/coercion order and releases native handles after accepted and rejected metadata',()=>{
 const trace=run=>{const calls=[];const book={get name(){calls.push('name');return''},get displayName(){calls.push('display');return undefined},get value(){calls.push('value');return null},get text(){calls.push('text');return false},get creator(){calls.push('creator');return{}},get author(){calls.push('author');return undefined},get givenName(){calls.push('given');return null},get firstName(){calls.push('first');return'First'},get familyName(){calls.push('family');return'Last'},get lastName(){calls.push('last');throw Error('must stay lazy')}};return{result:run(book),calls}};
 expect(trace(native.normalizeBookAuthor)).toEqual(trace(reference.normalizeBookAuthor));
 const coerce=run=>{const calls=[];const value={[Symbol.toPrimitive](hint){calls.push('value:'+hint);return'NASA_and_AI.epub'}},fallback={[Symbol.toPrimitive](){calls.push('fallback');throw Error('lazy')}};return{result:run(value,fallback),calls}};
 expect(coerce(native.normalizeBookTitle)).toEqual(coerce(reference.normalizeBookTitle));
 const changing=run=>{let reads=0;const calls=[];const book={title:'fallback',get spineTitleOverride(){calls.push('override');return ++reads===1?'first':{replace(pattern,value){calls.push('replace:'+pattern+':'+value);return{trim(){calls.push('trim');return 'Changed'}}}}}};return{result:run(book),calls}};
 expect(changing(native.displayBookTitle)).toEqual(changing(reference.displayBookTitle));
 native.normalizeBookTitle('Warmup');native.normalizeBookAuthor(['Warmup']);native.displayBookTitle({title:'Warmup'});
 const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks(),bytes=shelfWasm.memory.buffer.byteLength;
 for(let n=0;n<100;n++){
  expect(native.normalizeBookAuthor({author:['First',{familyName:'Last'}]})).toBe('First, Last');
  expect(()=>native.normalizeBookAuthor({get name(){throw Error('getter')}})).toThrow('getter');
  let reads=0;expect(()=>native.displayBookTitle({get spineTitleOverride(){return ++reads===1?'first':42}})).toThrow();
  expect(()=>native.normalizeBookTitle({[Symbol.toPrimitive](){throw Error('coercion')}})).toThrow('coercion');
 }
 expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);expect(shelfWasm.memory.buffer.byteLength).toBe(bytes);
});

it('uses the already-loaded reader module when the shelf has not been loaded',async()=>{
 const {rustUI}=await import('./helpers/rust-ui-ready.js');
 const loader=await import('../../src/js/rust-shelf.js');
 const shelf=vi.spyOn(loader,'getRustShelf').mockReturnValue(null);
 const require=vi.spyOn(loader,'needRustShelf');
 try {
  expect(native.normalizeBookTitle('the_book.epub')).toBe('The Book');
  expect(native.normalizeBookAuthor({givenName:'Úrsula',familyName:'Le Guin'})).toBe('Úrsula Le Guin');
  expect(native.displayBookTitle({title:'Original',spineTitleOverride:'Edited'})).toBe('Edited');
  const count=rustUI.ui_live_handles(),callbacks=rustUI.ui_pending_callbacks();
  for(let n=0;n<100;n++)expect(native.normalizeBookTitle('NASA_and_AI.pdf')).toBe('NASA and AI');
  expect(rustUI.ui_live_handles()).toBe(count);expect(rustUI.ui_pending_callbacks()).toBe(callbacks);
  expect(require).not.toHaveBeenCalled();
 } finally { shelf.mockRestore();require.mockRestore(); }
});
