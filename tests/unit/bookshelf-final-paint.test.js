import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

// Only the scene's synchronous paint/dirty contract is modeled here. No GPU,
// duration, clock, quality or runtime observation hook is substituted.
const state=vi.hoisted(()=>({ views:[], events:[], layout:null, owner:null,
  native:null, final:false, away:false, dirty:false, complete:false, insertion:null }));
const currentSpine=()=>state.layout?.entries.find(entry=>entry.book?.id==='final-paint')?.node;
function paint(reason) {
  state.away=Boolean(currentSpine()?.classList.contains('is-away'));state.dirty=false;
  if(state.complete && !state.away) {
    state.owner='room';state.layout.stage.append(state.native);
    if(state.final)state.events.push({type:'transfer',reason,node:state.native,parent:state.native.parentElement});
  }
  if(state.final)state.events.push({type:'paint',reason,away:state.away,spine:currentSpine()});
}
vi.mock('../../src/js/bookshelf-scene.js',()=>({ createBookshelfScene(layout) {
  state.layout=layout;state.away=Boolean(currentSpine()?.classList.contains('is-away'));
  return {
    updateLayout(next) { state.layout=next;state.dirty=true;if(state.final)state.events.push({type:'layout'});paint('layout'); },
    flush() {
      if(state.final)state.events.push({type:'flush'});
      const away=Boolean(currentSpine()?.classList.contains('is-away'));
      if(!state.dirty && state.away===away)return false;
      paint('flush');return true;
    },
    setPaintHeld() {}, setPresentationActive() {},getInspectionZoom:()=>1,
    getBookPose:()=>({centerX:45,centerY:200,width:100,height:160,thickness:28,scale:.7,angle:90,pitch:0,roll:0}),
    getReturnPose:()=>({centerX:45,centerY:200,width:100,height:160,thickness:28,scale:.7,angle:90,pitch:0,roll:0}),
    updateEntry() {},
    returnBook(_node,{nativePresentation}) {
      let resolve;const finished=new Promise(done=>{resolve=done;});
      state.native=document.createElement('canvas');state.native.className='actual-shared-node';
      const returnHost=document.querySelector('.ihr-flyout--return .ihr-flyout__book');
      returnHost.append(state.native);state.owner='insertion';
      const handle={finished,finish() {
        state.complete=true;state.final=true;state.events.push({type:'insertion-complete'});resolve();
      },cancel() {
        if(state.final)state.events.push({type:'insertion-cancel'});
        state.complete=true;resolve();
      }};
      state.insertion=handle;return handle;
    },
    dispose() {}
  };
} }));
vi.mock('../../src/js/book-model.js',()=>({
  getBookRenderer:()=>({}),fitCoverImage:vi.fn(),
  planReadingBookPose:()=>({x:0,y:0,scale:1,angle:0,pitch:0,coverOpen:1}),
  bookView(host,_book,_style,dimensions) {
    const canvas=document.createElement('canvas');host.append(canvas);
    let pose={...dimensions.initialPose,pageTheme:1},snapshot;
    const done=()=>({finished:Promise.resolve(),cancel() {}});
    const view={canvas,ready:Promise.resolve(),dimensions,
      draw(next) {pose={...pose,...next};},getPose:()=>({...pose}),getPageTheme:()=>pose.pageTheme,
      setPageTheme(value) {pose.pageTheme=value;},releaseToSnapshot() {},deferDrawing() {},setCompactReturnFrame() {},
      hasPageSnapshot:next=>snapshot===next,setPageSnapshot(next) {snapshot=next;return true;},alignToPage:()=>true,
      prepareReturnAppearance:async()=>true,updateBookmark() {},
      animate(frames) {view.draw({...pose,...frames.at(-1).transform});return done();},
      animateCoverOpen() {view.draw({...pose,coverOpen:1});return done();},
      animateCoverClose() {view.draw({...pose,coverOpen:0});return done();},animateBookmark:done,
      handoffToShelfInsertion(start) {return start({canvas});},
      dispose() {
        if(state.final)state.events.push({type:'dispose',owner:state.owner,native:state.native});
        // The real broker only removes a node still owned by this lease.
        if(state.owner==='insertion')state.native?.remove();canvas.remove();
      }};
    state.views.push(view);return view;
  }
}));

let shelf,container,book,frames,serial;
const fonts=Object.getOwnPropertyDescriptor(document,'fonts');
const snapshot=()=>({source:document.createElement('canvas'),paper:{source:document.createElement('canvas')},
  displayBounds:{left:8,top:48,width:374,height:561},width:374,height:561});
async function openReader() {
  const node=container.querySelector('.ihr-spine');
  node.getBoundingClientRect=()=>({left:20,top:100,width:28,height:160,right:48,bottom:260});node.click();
  await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout__cover-target.is-ready')).not.toBeNull());
  document.querySelector('.ihr-flyout__cover-target').click();
  await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout')).toBeNull());
  expect(shelf.hasReaderOrigin(book.id)).toBe(true);
}
async function startReturn(queued) {
  await openReader();shelf.setReturningBook(book.id);
  const result=shelf.returnToShelf(book.id,{book,pageSnapshot:snapshot(),onPageReady:()=>{
    if(queued)shelf.queueRefresh(queued);
  }});
  await vi.waitFor(()=>expect(state.insertion).not.toBeNull());return {result};
}
const finalPaints=()=>state.events.filter(event=>event.type==='paint');
function expectSafety() {
  const transfer=state.events.findIndex(event=>event.type==='transfer');
  const dispose=state.events.findIndex(event=>event.type==='dispose');
  expect(transfer).toBeGreaterThanOrEqual(0);expect(dispose).toBeGreaterThan(transfer);
  expect(state.events[dispose].owner).toBe('room');expect(state.native.isConnected).toBe(true);
  expect(state.native.parentElement).toBe(state.layout.stage);
  expect(finalPaints().every(event=>event.away===false)).toBe(true);
  expect(document.querySelector('.ihr-flyout')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.ihr-spine[data-book-id="final-paint"]'));
}
beforeEach(()=>{
  localStorage.clear();localStorage.setItem('inhouse-read-shelf-plants','[]');
  Object.assign(state,{views:[],events:[],layout:null,owner:null,native:null,final:false,away:false,dirty:false,complete:false,insertion:null});
  frames=new Map();serial=0;
  vi.stubGlobal('WebGLRenderingContext',function(){});
  vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));
  vi.stubGlobal('matchMedia',query=>({matches:/reduce/.test(query),addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:new Promise(()=>{})}});
  container=document.createElement('div');document.body.append(container);
  book={id:'final-paint',title:'Same physical book',author:'Reader',format:'PDF',progressFraction:.7,locator:9};
  shelf=renderBookshelf(container,[book],{shelfWidth:390,sections:false,revealDuration:0,holdMs:0,
    onOpenBook:(_book,context)=>context.finish({pageSnapshot:snapshot()})});
});
afterEach(()=>{
  shelf?.destroy();shelf=null;document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();
  if(fonts)Object.defineProperty(document,'fonts',fonts);else delete document.fonts;
});

describe('final return paint consumes a queued layout before disposing its native owner',()=>{
  it('identical queued records require only one final room paint and retain transfer/focus safety',async()=>{
    const {result}=await startReturn([{...book}]);state.insertion.finish();await expect(result).resolves.toBe(true);
    expectSafety();expect(finalPaints()).toHaveLength(1);expect(finalPaints()[0].reason).toBe('layout');
  });
  it('without a queued layout the restored spine still requires a final flush before disposal',async()=>{
    const {result}=await startReturn(null);state.insertion.finish();await expect(result).resolves.toBe(true);
    expectSafety();expect(finalPaints()).toHaveLength(1);expect(finalPaints()[0].reason).toBe('flush');
  });
  it('transfers before disposing and focuses the current replacement semantic node with genuine queued metadata',async()=>{
    const next={...book,title:'New title from storage',author:'New author'};
    const {result}=await startReturn([next]);const oldNode=currentSpine();state.insertion.finish();await expect(result).resolves.toBe(true);
    expectSafety();const landed=currentSpine();expect(landed).not.toBe(oldNode);expect(oldNode.isConnected).toBe(false);
    expect(landed.getAttribute('aria-label')).toContain(next.title);
    expect(state.events.filter(event=>event.type==='transfer').at(-1).parent).toBe(state.layout.stage);
    expect(state.events.find(event=>event.type==='dispose').native).toBe(state.native);
  });
  it('cancellation retains the original restore-flush-dispose order and applies queued layout afterwards',async()=>{
    const {result}=await startReturn([{...book,title:'Queued on cancel'}]);
    state.final=true;state.events=[];window.dispatchEvent(new Event('resize'));await expect(result).resolves.toBe(false);
    const events=state.events.map(event=>event.type),flush=events.indexOf('flush'),dispose=events.indexOf('dispose'),layout=events.indexOf('layout');
    expect(flush).toBeGreaterThanOrEqual(0);expect(dispose).toBeGreaterThan(flush);expect(layout).toBeGreaterThan(dispose);
    expect(state.events[dispose].owner).toBe('room');expect(state.native.isConnected).toBe(true);
    expect(document.querySelector('.ihr-flyout')).toBeNull();expect(currentSpine().classList.contains('is-away')).toBe(false);
  });
});
