import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';
vi.mock('../../src/js/book-model.js',() => ({
  getBookRenderer:() => null,bookView:() => null,
  planReadingBookPose:() => ({ x:0,y:0,scale:1,angle:0,pitch:0,coverOpen:1 })
}));
let shelf,container,book;
function contact(node,type) {
  const event=new Event(type,{bubbles:true,cancelable:true});
  Object.assign(event,{pointerId:7,pointerType:'mouse',isPrimary:true,button:0,clientX:40,clientY:160});
  node.dispatchEvent(event);
}
const target=()=>container.querySelector('.ihr-spine');
beforeEach(()=>{
  localStorage.clear();vi.stubGlobal('WebGLRenderingContext',undefined);vi.stubGlobal('WebGL2RenderingContext',undefined);
  vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  container=document.createElement('div');document.body.append(container);
  book={id:'fallback-click',title:'Before sync',format:'PDF',wordCount:80000,progressFraction:.2};
  shelf=renderBookshelf(container,[book],{shelfWidth:390,sections:false,revealDuration:0,holdMs:0});
  target().getBoundingClientRect=()=>({left:26,top:80,width:28,height:160,right:54,bottom:240});
});
afterEach(()=>{shelf.destroy();document.body.replaceChildren();vi.unstubAllGlobals();});
describe('legacy mouse tap with a real queued record refresh',()=>{
  it('keeps the pointerup target connected through compatibility click and applies the queued record after close',async()=>{
    const down=target(),latest={...book,title:'After sync',progressFraction:.73,locator:9};
    contact(down,'pointerdown');shelf.queueRefresh([latest]);
    contact(down,'pointerup');
    expect(down.isConnected).toBe(true);expect(target()).toBe(down);
    // A native compatibility click is delivered to the original button only
    // while that node survives pointerup. Detached-node dispatch is not used.
    if(down.isConnected)down.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,button:0,clientX:40,clientY:160}));
    await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout__book--fallback')).not.toBeNull());
    shelf.close({instant:true});
    await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout')).toBeNull());
    await vi.waitFor(()=>expect(target().getAttribute('aria-label')).toContain('After sync'));
    expect(target().getAttribute('aria-label')).toContain('73 %');
  });
  it('still flushes a cancelled contact immediately and never opens a book',()=>{
    const down=target(),latest={...book,title:'Cancelled sync',progressFraction:.6};
    contact(down,'pointerdown');shelf.queueRefresh([latest]);contact(down,'pointercancel');
    expect(down.isConnected).toBe(false);expect(target().getAttribute('aria-label')).toContain('Cancelled sync');
    expect(document.querySelector('.ihr-flyout')).toBeNull();
  });
});
