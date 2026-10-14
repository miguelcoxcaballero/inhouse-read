import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';
import { canAdoptShelfMetadata } from '../../src/js/shelf-metadata-records.js';

const observed=vi.hoisted(()=>({core:null,calls:0,live:0,prepared:[],disposed:0,layout:null,previews:[],adoptions:0}));
vi.mock('../../src/js/rust-core.js',async original=>({...await original(),getRustCore:()=>observed.core}));
vi.mock('../../src/js/shelf-placement-wasm.js',async original=>{
  const actual=await original();return{...actual,createShelfPlacementSession(objects,options){
    const session=actual.createShelfPlacementSession(objects,options);
    observed.prepared.push({inputs:objects.map(object=>({key:object.key,width:object.width,book:object.book})),options:{...options}});
    return session&&{move:(...args)=>session.move(...args),dispose(){observed.disposed++;session.dispose();}};
  }};
});
vi.mock('../../src/js/book-model.js',()=>({getBookRenderer:()=>({}),bookView:()=>null,fitCoverImage:vi.fn(),planReadingBookPose:vi.fn()}));
vi.mock('../../src/js/bookshelf-scene.js',()=>({createBookshelfScene(layout){
  observed.layout=layout;
  const hit=()=>observed.layout.entries.find(entry=>entry.book)?.node;
  return{getObjectAtPoint:hit,getBookAtPoint:hit,getBookPose:()=>null,
    getDropPosition:(x)=>({shelf:1,x:Math.max(0,Math.min(1,x/390))}),
    setDropPosition(){},setTrashHover(){},previewPlacements(objects,key){if(objects)observed.previews.push({objects,key});},
    updateLayout(next){observed.layout=next;},updateEntry(){},flush:()=>false,dispose(){},
    getInspectionZoom:()=>1,getInspectionView:()=>({zoom:1,panX:0,panY:0,width:390,height:844,centerX:195,centerY:422}),
    setInspectionView:view=>view,beginInspectionGesture(){},setPresentationActive(){},setPaintHeld(){},animateFromRects(){},
    adoptMetadataRecords(previous,next){
      if(!canAdoptShelfMetadata(previous,next))return false;
      observed.adoptions++;for(const book of next)observed.layout.entries.find(entry=>entry.book?.id===book.id).book=book;
      return true;
    },
  };
}}));
let core,shelf,container,records,frames,serial,viewport;
const fonts=Object.getOwnPropertyDescriptor(document,'fonts');
const visualViewport=Object.getOwnPropertyDescriptor(window,'visualViewport');
const microtasks=async()=>{for(let index=0;index<16;index++)await Promise.resolve();};
function frame(){const callbacks=[...frames.entries()];for(const[id,callback]of callbacks)if(frames.delete(id))callback(performance.now());}
const spine=()=>container.querySelector('.ihr-spine');
function pointer(type,{node=spine(),x=80,y=250}={}){
  const event=new MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});
  Object.defineProperties(event,{pointerId:{value:7},pointerType:{value:'mouse'},isPrimary:{value:true}});node.dispatchEvent(event);
}
async function begin(){pointer('pointerdown');await vi.advanceTimersByTimeAsync(450);expect(spine().classList.contains('is-lifted')).toBe(true);}
function move(x=180){pointer('pointermove',{x});frame();}
async function mount(){
  records=Array.from({length:20},(_,index)=>({id:`preview:${index}`,title:`Book ${index}`,format:'PDF',sourceType:'local',
    wordCount:78000,progressFraction:.3,progressDirty:true,progressUpdatedAt:1,shelfPosition:{shelf:Math.floor(index/5),x:.1+(index%5)*.18}}));
  shelf=renderBookshelf(container,records,{shelfWidth:390,sections:false,sort:'none',adoptMetadata:true,viewMode:'spine'});
  const bounds={left:0,top:0,width:390,height:844,right:390,bottom:844};
  container.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect=()=>bounds;
  for(const node of container.querySelectorAll('.ihr-spine'))node.getBoundingClientRect=()=>({left:60,top:100,width:28,height:160,right:88,bottom:260});
  await microtasks();
}
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync(resolve('src/wasm/inhouse_read_core.wasm')))).instance.exports;expect(typeof core.shelf_place).toBe('function');});
beforeEach(async()=>{
  vi.useFakeTimers();localStorage.clear();localStorage.setItem('inhouse-read-shelf-plants','[]');localStorage.setItem('inhouse-read-shelf-lamps','[]');
  observed.calls=observed.live=observed.disposed=observed.adoptions=0;observed.prepared=[];observed.previews=[];observed.layout=null;
  observed.core={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p)observed.live+=n*8;return p;},
    free_f64(p,n){core.free_f64(p,n);observed.live-=n*8;},shelf_place(...args){observed.calls++;return core.shelf_place(...args);}};
  vi.stubGlobal('WebGLRenderingContext',function(){});vi.stubGlobal('WebGL2RenderingContext',undefined);
  vi.stubGlobal('matchMedia',query=>({matches:/reduce/.test(query),addEventListener(){},removeEventListener(){}}));
  frames=new Map();serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:new Promise(()=>{})}});
  viewport=Object.assign(new EventTarget(),{width:390,height:844,scale:1});
  Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  container=document.createElement('div');document.body.append(container);await mount();
});
afterEach(()=>{
  shelf?.destroy();shelf=null;expect(observed.live).toBe(0);document.body.replaceChildren();
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
  if(fonts)Object.defineProperty(document,'fonts',fonts);else delete document.fonts;
  if(visualViewport)Object.defineProperty(window,'visualViewport',visualViewport);else delete window.visualViewport;
});
describe('actual bookshelf drag preview session lifecycle',()=>{
  it('reuses one owned session after two direct previews and disposes it on pointer cancellation',async()=>{
    // The JavaScript twin of the placement is gone: a direct preview now runs the kernel too (two
    // calls each, counted from the calls the initial layout already made), and the owned session
    // that replaces it from the third move on keeps its single call per move.
    const initial=observed.calls;
    await begin();move(120);move(140);expect(observed.prepared).toHaveLength(0);expect(observed.calls).toBe(initial+4);
    move(160);move(180);move(200);expect(observed.prepared).toHaveLength(1);expect(observed.calls).toBe(initial+4+3);expect(observed.live).toBe(0);
    expect(observed.previews).toHaveLength(5);pointer('pointercancel');expect(observed.disposed).toBe(1);
    const calls=observed.calls;frame();expect(observed.calls).toBe(calls);
  });
  it('invalidates on viewport change and starts the policy again before preparing fresh geometry',async()=>{
    const initial=observed.calls;
    await begin();move(120);move(140);move(160);expect(observed.prepared).toHaveLength(1);
    viewport.width=420;viewport.dispatchEvent(new Event('resize'));expect(observed.disposed).toBe(1);
    move(170);move(180);expect(observed.prepared).toHaveLength(1);move(190);expect(observed.prepared).toHaveLength(2);
    // Two direct previews and one session move before the resize, the same again after it.
    expect(observed.calls).toBe(initial+2*(2*2+1));pointer('pointercancel');expect(observed.disposed).toBe(2);
  });
  it('uses current metadata references on the next drag after adoption',async()=>{
    await begin();move(120);move(140);move(160);pointer('pointercancel');await vi.advanceTimersByTimeAsync(0);
    const latest=records.map(book=>({...book,progressDirty:false,progressUpdatedAt:2,readingHistory:[{locator:{page:7}}]}));
    shelf.refresh(latest);await microtasks();expect(observed.adoptions).toBe(1);
    await begin();move(120);move(140);move(160);expect(observed.prepared).toHaveLength(2);
    for(const item of observed.prepared[1].inputs.filter(item=>item.book))expect(item.book).toBe(latest.find(book=>`book:${book.id}`===item.key));
    expect(observed.previews.at(-1).objects.find(item=>item.key===`book:${latest[0].id}`)?.book).toBe(latest[0]);
    pointer('pointercancel');expect(observed.disposed).toBe(2);
  });
  it('disposes on window resize and destroy without running a pending preview afterwards',async()=>{
    await begin();move(120);move(140);move(160);window.dispatchEvent(new Event('resize'));expect(observed.disposed).toBe(1);
    expect(container.querySelector('.ihr-bookshelf').classList.contains('is-arranging')).toBe(false);frame();await microtasks();
    await begin();move(120);move(140);move(160);expect(observed.prepared).toHaveLength(2);
    pointer('pointermove',{x:200});const calls=observed.calls;shelf.destroy();shelf=null;
    expect(observed.disposed).toBe(2);frame();expect(observed.calls).toBe(calls);expect(observed.live).toBe(0);
  });
});
