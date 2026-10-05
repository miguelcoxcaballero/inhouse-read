import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderBookshelf} from '../../src/js/bookshelf.js';

const observed=vi.hoisted(()=>({native:true,layout:null,hit:null,updates:0,dispose:vi.fn(),prepared:vi.fn()}));
vi.mock('../../src/js/book-model.js',()=>({
  getBookRenderer:()=>observed.native?{}:null,bookView:()=>null,fitCoverImage:vi.fn(),
  planReadingBookPose:()=>({x:0,y:0,scale:1,angle:0,pitch:0,coverOpen:1})
}));
vi.mock('../../src/js/bookshelf-scene.js',()=>({createBookshelfScene(layout){
  observed.layout=layout;
  const hit=()=>observed.hit||observed.layout.entries.find(entry=>entry.book)?.node;
  return {getBookAtPoint:hit,getObjectAtPoint:hit,getBookPose:()=>null,
    updateLayout(next){observed.layout=next;observed.updates++;},updateEntry:vi.fn(),flush:()=>false,
    getInspectionZoom:()=>1,getInspectionView:()=>({zoom:1,panX:0,panY:0,width:390,height:844,centerX:195,centerY:422}),
    setInspectionView:view=>view,beginInspectionGesture:vi.fn(),setPresentationActive:vi.fn(),
    setDropPosition:vi.fn(),previewPlacements:vi.fn(),setTrashHover:vi.fn(),getDropPosition:()=>null,
    animateFromRects:vi.fn(),
    dispose:observed.dispose};
}}));

let shelf,container,book,frames,serial;
const originalFonts=Object.getOwnPropertyDescriptor(document,'fonts');
const spine=()=>container.querySelector('.ihr-spine');
function pointer(node,type,{kind='mouse',id=7,x=40,y=160}={}){
  const event=new MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});
  Object.defineProperties(event,{pointerType:{value:kind},pointerId:{value:id},isPrimary:{value:true}});
  node.dispatchEvent(event);
}
function click(node){if(node.isConnected)node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,button:0,clientX:40,clientY:160}));}
function frame(){const callbacks=[...frames.entries()];for(const [id,callback]of callbacks)if(frames.delete(id))callback(performance.now());}
const cancelSelection=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
function mount(native=true,extra={}){
  observed.native=native;observed.layout=null;observed.hit=null;observed.updates=0;
  shelf=renderBookshelf(container,[book],{shelfWidth:390,sections:false,sort:'none',viewMode:'spine',
    onPrepareBook:observed.prepared,coverSrcFor:()=>new Promise(()=>{}),...extra});
  spine().getBoundingClientRect=()=>({left:26,top:80,width:28,height:160,right:54,bottom:240});
}
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();
  localStorage.setItem('inhouse-read-shelf-plants','[]');
  vi.stubGlobal('WebGLRenderingContext',function(){});vi.stubGlobal('WebGL2RenderingContext',undefined);
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  frames=new Map();serial=0;vi.stubGlobal('requestAnimationFrame',callback=>{const id=++serial;frames.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frames.delete(id));
  Object.defineProperty(document,'fonts',{configurable:true,value:{ready:new Promise(()=>{})}});
  container=document.createElement('div');document.body.append(container);
  book={id:'compat-current',title:'Original painted record',author:'Reader',format:'PDF',sourceType:'local',wordCount:78000,progressFraction:.2};
});
afterEach(()=>{
  shelf?.destroy();shelf=null;document.body.replaceChildren();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
  if(originalFonts)Object.defineProperty(document,'fonts',originalFonts);else delete document.fonts;
});

describe('validated compatibility taps with genuine queued record changes',()=>{
  it.each([[true,'mouse'],[true,'touch'],[false,'mouse'],[false,'touch']])('retains the real hit and opens latest queued source/style/progress (WebGL %s, %s)',(native,kind)=>{
    mount(native);const down=spine(),latest={...book,title:'Current queued title',author:'Current author',progressFraction:.73,locator:{page:9},content:new Blob(['current bytes']),spineFontSize:33,spineColorOverride:'#116644'};
    pointer(down,'pointerdown',{kind});shelf.queueRefresh([latest]);pointer(down,'pointerup',{kind});
    if(kind==='mouse'){
      expect(down.isConnected).toBe(true);expect(spine()).toBe(down);click(down);
    }else{
      // Touch activates synchronously: the accepted current list has already
      // replaced the old hit before pointerup returns.
      expect(down.isConnected).toBe(false);expect(spine()).not.toBe(down);
    }
    expect(observed.prepared).toHaveBeenCalledOnce();expect(observed.prepared.mock.calls[0][0]).toBe(latest);
    cancelSelection();expect(spine().getAttribute('aria-label')).toContain('Current queued title');
    expect(spine().getAttribute('aria-label')).toContain('73 %');
    // No queued list is thrown away merely because it supplied the open record.
    expect(spine()).not.toBe(down);
  });

  it('retains the tap across a second genuine synchronous refresh before mouse click',()=>{
    mount();const down=spine();pointer(down,'pointerdown');shelf.queueRefresh([{...book,title:'First queued'}]);pointer(down,'pointerup');
    const latest={...book,title:'Second current list',progressFraction:.8};shelf.refresh([latest]);
    expect(down.isConnected).toBe(true);expect(observed.updates).toBe(0);click(down);
    expect(observed.prepared.mock.calls[0][0]).toBe(latest);cancelSelection();
    expect(spine().getAttribute('aria-label')).toContain('Second current list');
  });

  it('keeps an already scheduled real refresh frame from removing the released mouse hit',()=>{
    mount();const down=spine(),latest={...book,title:'Current frame list'};
    shelf.queueRefresh([latest]);expect(frames.size).toBe(1);
    pointer(down,'pointerdown');pointer(down,'pointerup');frame();
    expect(down.isConnected).toBe(true);expect(observed.updates).toBe(0);click(down);
    expect(observed.prepared).toHaveBeenCalledWith(latest,expect.any(Object));
  });

  it('flushes the original zero-delay cleanup when no mouse compatibility click arrives',async()=>{
    mount();const down=spine();pointer(down,'pointerdown');shelf.queueRefresh([{...book,title:'No click final list'}]);pointer(down,'pointerup');
    expect(down.isConnected).toBe(true);await vi.advanceTimersByTimeAsync(0);
    expect(down.isConnected).toBe(false);expect(observed.updates).toBe(1);
    expect(spine().getAttribute('aria-label')).toContain('No click final list');expect(observed.prepared).not.toHaveBeenCalled();
  });

  it('cancels the previous cleanup on a new book contact without flushing during that contact',async()=>{
    mount();const down=spine(),latest={...book,title:'Latest second contact'};
    pointer(down,'pointerdown');shelf.queueRefresh([latest]);pointer(down,'pointerup');
    pointer(down,'pointerdown',{id:8});await vi.advanceTimersByTimeAsync(0);
    expect(down.isConnected).toBe(true);expect(observed.updates).toBe(0);
    pointer(down,'pointerup',{id:8});click(down);expect(observed.prepared).toHaveBeenCalledOnce();
    expect(observed.prepared.mock.calls[0][0]).toBe(latest);
  });

  it('does not run a pending tap cleanup after shelf destroy',async()=>{
    mount();const down=spine();pointer(down,'pointerdown');shelf.queueRefresh([{...book,title:'Destroy pending'}]);pointer(down,'pointerup');
    shelf.destroy();expect(observed.dispose).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(0);
    expect(observed.updates).toBe(0);expect(observed.prepared).not.toHaveBeenCalled();expect(container.querySelector('.ihr-spine')).toBeNull();
  });

  it('preserves immediate refresh on an actually cancelled touch',()=>{
    mount();const down=spine();pointer(down,'pointerdown',{kind:'touch'});shelf.queueRefresh([{...book,title:'Cancelled final list'}]);pointer(down,'pointercancel',{kind:'touch'});
    expect(down.isConnected).toBe(false);expect(spine().getAttribute('aria-label')).toContain('Cancelled final list');expect(observed.prepared).not.toHaveBeenCalled();
  });

  it('preserves active hold suppression and its original refresh',async()=>{
    mount();const down=spine();pointer(down,'pointerdown');await vi.advanceTimersByTimeAsync(450);
    shelf.queueRefresh([{...book,title:'Held final list'}]);pointer(down,'pointerup');
    expect(down.isConnected).toBe(false);expect(spine().getAttribute('aria-label')).toContain('Held final list');expect(observed.prepared).not.toHaveBeenCalled();
  });

  it('preserves actual touch scrolling rather than converting it to a tap',()=>{
    mount();const down=spine();pointer(down,'pointerdown',{kind:'touch'});shelf.queueRefresh([{...book,title:'Scrolled final list'}]);
    pointer(down,'pointermove',{kind:'touch',y:210});pointer(down,'pointerup',{kind:'touch',y:210});
    expect(down.isConnected).toBe(false);expect(spine().getAttribute('aria-label')).toContain('Scrolled final list');expect(observed.prepared).not.toHaveBeenCalled();
  });

  it('does not open a record removed by the accepted queued list',()=>{
    mount();const down=spine();pointer(down,'pointerdown');shelf.queueRefresh([]);pointer(down,'pointerup');
    expect(down.isConnected).toBe(true);click(down);expect(observed.prepared).not.toHaveBeenCalled();expect(spine()).toBeNull();
  });

  it('uses the original preparing UI if the accepted source is no longer ready',()=>{
    mount(true,{getBookGeometryState:record=>record.pending?'pending':'ready'});const down=spine();
    pointer(down,'pointerdown');shelf.queueRefresh([{...book,title:'Preparing current source',pending:true}]);pointer(down,'pointerup');
    expect(down.isConnected).toBe(true);click(down);expect(observed.prepared).not.toHaveBeenCalled();expect(spine()).toBeNull();
    expect(container.textContent).toContain('Preparando Preparing current source');
  });

  it('keeps a genuinely blocked queued list and never opens its stale painted record',async()=>{
    vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
    mount();const beforePlacement=spine();
    // Exercise the public keyboard placement path, which performs its initial
    // layout and holds the original 560 ms window. Tap its CURRENT painted hit.
    beforePlacement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));
    const down=spine();expect(down.isConnected).toBe(true);
    const latest={...book,title:'Latest after reordering',content:new Blob(['current reordered bytes']),progressFraction:.84};
    pointer(down,'pointerdown');shelf.queueRefresh([latest]);pointer(down,'pointerup');click(down);
    expect(down.isConnected).toBe(true);expect(spine()).toBe(down);
    expect(observed.prepared).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(560);
    expect(down.isConnected).toBe(false);expect(spine().getAttribute('aria-label')).toContain('Latest after reordering');
    expect(spine().getAttribute('aria-label')).toContain('84 %');
    click(spine());expect(observed.prepared).toHaveBeenCalledOnce();
    expect(observed.prepared.mock.calls[0][0]).toBe(latest);
  });
});
