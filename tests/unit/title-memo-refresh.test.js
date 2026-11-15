// The shelf refresh remembers the cleaned title and author of plain strings (rust-ui/src/title_memo.rs).
// A remembered answer must be the answer: every refresh here is compared with what the module's own,
// unremembered cleaning (book_normalize_title / book_normalize_author, what the frozen JavaScript refresh
// called for every book) gives for the same records, the first time and every time after.
import {it,expect} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';

const written={catch(){return written}};
function fixture(){
 const patches=[],shelf={isInteracting:false,update(){},queueRefresh(){}};
 const host={state:{appDisposed:false,closingReader:false,cloudRoomChanged:false,shelf,shelfRecords:null,lengthStatusVersion:2,shelfLengthStatusVersion:2},
  els:{readerScreen:{hidden:true}},library:{patch:async(id,patch)=>{patches.push([id,patch]);return{id,sourceType:'local',...patch}}},
  wordCountQueue:{ensure:()=>written},nativeImportShelfGate:{deferRefresh:()=>false},libraryHost:{},createShelf:()=>shelf};
 return{host,patches};
}
// The frozen refresh's own lines (tests/unit/helpers/reference-app-refresh.js), on the unremembered cleaning.
function expected(books){
 const patches=[];
 for(const book of books){
  const title=rustShelf.book_normalize_title(book.title||book.name,''),author=rustShelf.book_normalize_author(book.author),patch={};
  if(title!==book.title)patch.title=title;
  if(author!==(book.author||''))patch.author=author||null;
  if(Object.keys(patch).length)patches.push([book.id,patch]);
 }
 return patches;
}
async function refreshed(books){const{host,patches}=fixture();await rustShelf.app_refresh_after_load(host,books,undefined,true);return patches;}
function random(seed){let state=seed>>>0;return()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const WORDS=['the','LIBRO','de','árbol','Ñandú','of','and','PDF','usa','mcDonald','ǆungla','ß','ﬁn','a','El','quijote','№5','x²','…','..','：','naïve','İstanbul','\ud800','\udc00a','😀','ｆｕｌｌ'];
const JOINS=[' ','_','  ',' , ','. ',': ','/','\\','\t','\u00a0','\n',' ;',''];
function text(next,long){
 let out='';const count=1+Math.floor(next()*(long?30:6));
 for(let n=0;n<count;n++)out+=WORDS[Math.floor(next()*WORDS.length)]+JOINS[Math.floor(next()*JOINS.length)];
 if(next()<.2)out+=['.epub','.PDF','.mobi','...','…  ','.cbz'][Math.floor(next()*6)];
 return next()<.1?`  ${out}  `:out;
}
function library(next,count,from=0){
 return Array.from({length:count},(_,n)=>{
  const book={id:`local:${from+n}`,sourceType:'local'},kind=next();
  if(kind<.06)book.title='';else if(kind<.1)book.title='   ';else if(kind<.13)book.title=null;else if(kind<.16)book.title=42+n;
  else book.title=text(next,next()<.15);
  if(next()<.3)book.name=text(next,false);
  const author=next();
  if(author<.5)book.author=text(next,false);else if(author<.6)book.author='';else if(author<.7)book.author=null;
  else if(author<.8)book.author={name:text(next,false)};else if(author<.9)book.author=[text(next,false),{displayName:text(next,false)}];
  return book;
 });
}

it('patches the same records with the same fields, remembered or not',async()=>{
 const next=random(20261114);let compared=0,patched=0;
 for(let round=0;round<60;round++){
  const books=library(next,1+Math.floor(next()*40),round*100),want=expected(books);
  // Three refreshes of the same library: the first fills what the next two only look up.
  for(let pass=0;pass<3;pass++){expect(await refreshed(books),`library ${round}, pass ${pass}`).toEqual(want);compared+=books.length;}
  patched+=want.length;
 }
 expect(compared).toBeGreaterThan(3000);expect(patched).toBeGreaterThan(500);
});

it('asks a value that is not a string for its text every time',async()=>{
 let asked=0;const title={toString(){asked++;return'un_título.epub'}},author={get name(){asked+=100;return'  Ana  '}};
 const books=[{id:'a',sourceType:'local',title,author}];
 expected(books);const once=asked;asked=0;
 for(let pass=1;pass<=3;pass++){await refreshed(books);expect(asked).toBe(once*pass);}
 expect(once).toBeGreaterThan(100);
});

it('starts again past its room without changing an answer',async()=>{
 // More distinct titles and authors than the memo keeps (4,096), then the same library again.
 const books=Array.from({length:5000},(_,n)=>({id:`local:${n}`,sourceType:'local',title:`el_libro ${n}.epub`,author:`  autora ${n}`}));
 const want=expected(books);expect(want.length).toBe(5000);
 expect(await refreshed(books)).toEqual(want);expect(await refreshed(books)).toEqual(want);
 const handles=rustShelf.shelf_live_handles();
 expect(await refreshed(books.slice(0,300))).toEqual(want.slice(0,300));await Promise.resolve();
 expect(rustShelf.shelf_live_handles()).toBe(handles);
});
