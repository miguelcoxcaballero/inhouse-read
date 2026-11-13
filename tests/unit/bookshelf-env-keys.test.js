// The shelf's parts call other modules through the table bookshelf.js hands to the set-up (`shelfEnv`), read by name at
// each call. The shelf module now keeps the names' JavaScript strings with the shelf instead of building one per call
// (rust-ui/src/bookshelf/ctx.rs). What must not change: the table is still read at every call, so an entry replaced
// after the shelf was built is the one called, a getter is still run, a name added later is still found, and
// nothing is left in the module when the shelf goes.
import {afterEach,describe,expect,it,vi} from 'vitest';
const seen=vi.hoisted(()=>({env:null}));
vi.mock('../../src/js/rust-shelf.js',async importOriginal=>{
 const actual=await importOriginal();
 // The real module, with the set-up's first argument remembered.
 const watched=new Proxy(actual.needRustShelf(),{get(target,name){
  if(name==='shelf_mount')return(env,...rest)=>{seen.env=env;return target.shelf_mount(env,...rest);};
  return target[name];}});
 return{...actual,needRustShelf:()=>watched};
});
vi.mock('../../src/js/cover-appearance.js',async importOriginal=>({...await importOriginal(),readCoverAspectRatio:vi.fn(async()=>null)}));
import {renderBookshelf} from '../../src/js/bookshelf.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';

const books=count=>Array.from({length:count},(_,i)=>({id:`local:libro-${i}.epub:${2000+i}`,title:`Libro ${i}`,author:`Autora ${i}`,format:'EPUB',sourceType:'local',addedAt:1_700_000_000_000,lastOpenedAt:1_700_000_000_000+i,progressFraction:0}));
let container,shelf,restore=[];
const settle=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
function mount(count=3){
 container=document.createElement('div');document.body.append(container);
 shelf=renderBookshelf(container,books(count),{shelfWidth:390});
 return seen.env;
}
afterEach(()=>{shelf?.destroy();shelf=null;container?.remove();document.body.innerHTML='';for(const undo of restore.splice(0))undo();});
/** Replaces one entry of the table until the test ends. */
function replace(env,name,descriptor){
 const before=Object.getOwnPropertyDescriptor(env,name);
 Object.defineProperty(env,name,{configurable:true,enumerable:true,...descriptor});
 restore.push(()=>{if(before)Object.defineProperty(env,name,before);else delete env[name];});
}

describe('the names the shelf\'s parts call other modules by',()=>{
 it('are read from the table at every call: an entry replaced after the shelf was built is the one called',()=>{
  const env=mount(),original=env.normalizeBookAuthor,authors=[];
  expect(typeof original).toBe('function');
  replace(env,'normalizeBookAuthor',{writable:true,value:(...args)=>{authors.push(args[0]);return original(...args);}});
  shelf.refresh(books(5));
  expect(authors.length).toBeGreaterThan(0);expect(authors).toContain('Autora 4');
  const calls=authors.length;
  replace(env,'normalizeBookAuthor',{writable:true,value:original});
  shelf.refresh(books(6));
  expect(authors.length).toBe(calls);
 });
 it('still run a getter of the table at each call',()=>{
  const env=mount(),original=env.normalizeBookAuthor;let reads=0;const authors=[];
  replace(env,'normalizeBookAuthor',{get(){reads++;return(...args)=>{authors.push(args[0]);return original(...args);};}});
  shelf.refresh(books(4));
  expect(reads).toBeGreaterThan(0);expect(authors).toContain('Autora 3');expect(reads).toBe(authors.length);
 });
 it('report an entry that is gone as the call that failed, by its name',()=>{
  const env=mount();
  replace(env,'normalizeBookAuthor',{writable:true,value:undefined});
  expect(()=>shelf.refresh(books(5))).toThrow(/normalizeBookAuthor is not a function/);
 });
 it('are freed with the shelf: mounting and destroying shelves leaves no handle in the module',async()=>{
  // A shelf's own late work (fonts, covers, idle tasks) lets go of its handles a little after it is destroyed.
  const cycle=async()=>{mount();await settle();shelf.destroy();shelf=null;container.remove();await settle();};
  await cycle();await cycle();
  const before=module.shelf_live_handles();
  for(let round=0;round<6;round++)await cycle();
  expect(module.shelf_live_handles()).toBe(before);
 });
});
