import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

const views=vi.hoisted(()=>[]);
vi.mock('../../src/js/book-model.js',async()=>{
  const { bookmarkFor }=await import('../../src/js/bookshelf-layout.js');
  return {
    getBookRenderer:()=>null,
    planReadingBookPose:()=>({x:0,y:0,scale:1,angle:0,pitch:0,coverOpen:1}),
    bookView(host,record,_style,dimensions){
      const canvas=document.createElement('canvas');host.append(canvas);
      let currentBook=record,pose={...dimensions.initialPose,pageTheme:1},page,deferred=dimensions.deferDraw;
      const events=[],done=()=>({finished:Promise.resolve(),cancel(){}});
      const view={canvas,ready:Promise.resolve(),dimensions,events,
        draw:vi.fn((next,options)=>{pose={...pose,...next};if(options?.redraw!==false){deferred=false;events.push({kind:'paint',page,connected:canvas.isConnected});}}),
        deferDrawing:vi.fn(()=>{deferred=true;events.push({kind:'defer',connected:canvas.isConnected});}),
        releaseToSnapshot:vi.fn(()=>{deferred=false;}),
        getPose:()=>({...pose}),getPageTheme:()=>pose.pageTheme,
        setPageTheme:value=>{pose.pageTheme=value;},
        hasPageSnapshot:next=>page===next,
        setPageSnapshot:vi.fn(next=>{page=next;events.push({kind:'page',page});if(!deferred)view.draw(pose);return true;}),
        alignToPage:vi.fn(()=>{view.draw(pose);return true;}),
        updateBookmark:vi.fn(next=>{
          const changed=JSON.stringify(bookmarkFor(currentBook))!==JSON.stringify(bookmarkFor(next));
          currentBook={...currentBook,...next};events.push({kind:'bookmark',deferred,changed,connected:canvas.isConnected});
          // The real model invokes its invalidation synchronously; bookView's
          // waitingForFirstDraw gate must already be held before this callback.
          if(changed&&!deferred)view.draw(pose);return true;
        }),
        prepareReturnAppearance:vi.fn(async next=>{deferred=true;currentBook={...currentBook,...next};return true;}),
        animate:vi.fn(frames=>{view.draw({...pose,...frames.at(-1).transform});return done();}),
        animateCoverOpen:vi.fn(()=>{view.draw({...pose,coverOpen:1});return done();}),
        animateCoverClose:vi.fn(()=>{view.draw({...pose,coverOpen:0});return done();}),
        animateBookmark:vi.fn(done),dispose:vi.fn(()=>canvas.remove())};
      views.push(view);return view;
    }
  };
});

let shelf,container,book;
const lifted=()=>views.filter(view=>!view.dimensions.shelf);
const snapshot=()=>({source:document.createElement('canvas'),paper:{source:document.createElement('canvas')},
  displayBounds:{left:8,top:48,width:374,height:561},width:374,height:561});
const stubSpine=()=>{const node=container.querySelector('.ihr-spine');node.getBoundingClientRect=()=>({left:20,top:100,width:28,height:160,right:48,bottom:260});return node;};
async function openReader(){
  stubSpine().click();await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout__cover-target.is-ready')).not.toBeNull());
  document.querySelector('.ihr-flyout__cover-target').click();
  await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout')).toBeNull());
  expect(shelf.hasReaderOrigin(book.id)).toBe(true);
  lifted()[0].events.length=0;
}
beforeEach(()=>{
  views.length=0;localStorage.clear();
  vi.stubGlobal('matchMedia',query=>({matches:/reduce/.test(query),addEventListener(){},removeEventListener(){}}));
  container=document.createElement('div');document.body.append(container);
  book={id:'return-bootstrap',title:'The same case',author:'Reader',format:'PDF',progressFraction:0};
  shelf=renderBookshelf(container,[book],{shelfWidth:390,sections:false,revealDuration:0,holdMs:0,
    onOpenBook:(_book,context)=>context.finish({pageSnapshot:snapshot()})});
});
afterEach(()=>{shelf.destroy();document.body.replaceChildren();vi.unstubAllGlobals();});

describe('defer the reused return before its final bookmark invalidates',()=>{
  it('does not paint the old detached page when exact-case progress changes',async()=>{
    await openReader();const original=lifted()[0],closing=snapshot(),latest={...book,progressFraction:.8,locator:{kind:'pdf-page',value:8}};
    await expect(shelf.returnToShelf(book.id,{book:latest,pageSnapshot:closing})).resolves.toBe(true);
    expect(original.prepareReturnAppearance).not.toHaveBeenCalled();
    const pageIndex=original.events.findIndex(event=>event.kind==='page');
    expect(pageIndex).toBeGreaterThan(0);
    expect(original.events.slice(0,pageIndex).filter(event=>event.kind==='paint')).toHaveLength(0);
    const bookmark=original.events.find(event=>event.kind==='bookmark');
    expect(bookmark).toMatchObject({changed:true,deferred:true,connected:false});
    expect(original.alignToPage).toHaveBeenCalledExactlyOnceWith(closing.displayBounds);
    expect(lifted()).toHaveLength(1);expect(original.dispose).toHaveBeenCalledOnce();
  });
  it('defers the first-page ribbon even when the fraction stays zero',async()=>{
    await openReader();const original=lifted()[0];
    await shelf.returnToShelf(book.id,{book:{...book,locator:{kind:'pdf-page',value:1}},pageSnapshot:snapshot()});
    expect(original.prepareReturnAppearance).not.toHaveBeenCalled();
    expect(original.events.find(event=>event.kind==='bookmark')).toMatchObject({changed:true,deferred:true});
    const pageIndex=original.events.findIndex(event=>event.kind==='page');
    expect(original.events.slice(0,pageIndex).filter(event=>event.kind==='paint')).toHaveLength(0);
  });
  it('preserves the already deferred compatible HD upgrade',async()=>{
    await openReader();const original=lifted()[0],latest={...book,cover:'blob:HD',progressFraction:.7};
    await shelf.returnToShelf(book.id,{book:latest,pageSnapshot:snapshot()});
    expect(original.prepareReturnAppearance).toHaveBeenCalledOnce();
    expect(original.updateBookmark).toHaveBeenCalledExactlyOnceWith(latest);
    expect(original.events.find(event=>event.kind==='bookmark')).toMatchObject({deferred:true});
    const pageIndex=original.events.findIndex(event=>event.kind==='page');
    expect(original.events.slice(0,pageIndex).filter(event=>event.kind==='paint')).toHaveLength(0);
  });
  it('still installs and aligns the current page when the bookmark is unchanged',async()=>{
    await openReader();const original=lifted()[0],closing=snapshot();
    await shelf.returnToShelf(book.id,{book,pageSnapshot:closing});
    expect(original.updateBookmark).toHaveBeenCalledExactlyOnceWith(book);
    expect(original.events.find(event=>event.kind==='bookmark')).toMatchObject({changed:false,deferred:true});
    expect(original.setPageSnapshot).toHaveBeenLastCalledWith(closing);
    expect(original.alignToPage).toHaveBeenCalledExactlyOnceWith(closing.displayBounds);
    expect(original.animateCoverClose).toHaveBeenCalledOnce();
  });
  it('leaves the no-page fresh closed-case fallback untouched',async()=>{
    await openReader();const original=lifted()[0];
    await shelf.returnToShelf(book.id);
    expect(lifted()).toHaveLength(2);expect(original.updateBookmark).not.toHaveBeenCalled();
    expect(original.deferDrawing).not.toHaveBeenCalled();expect(original.dispose).toHaveBeenCalledOnce();
    expect(lifted()[1].dimensions.initialPose.coverOpen).toBe(0);
  });
});
