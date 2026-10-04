import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

const views=vi.hoisted(()=>[]);
vi.mock('../../src/js/book-model.js',()=>({
  getBookRenderer:()=>null,
  planReadingBookPose:()=>({x:0,y:0,scale:1,angle:0,pitch:0}),
  bookView(host) {
    const canvas=document.createElement('canvas');host.append(canvas);canvas.dataset.renderer='three-mesh';
    let pose={x:0,y:0,scale:1,angle:0,pageTheme:1},snapshot,paintedSnapshot,paintedPose;
    const done=()=>({finished:Promise.resolve(),cancel(){}});
    const view={
      canvas,ready:Promise.resolve(),
      draw:vi.fn(next=>{pose={...pose,...next,pageTheme:next.pageTheme??pose.pageTheme};paintedSnapshot=snapshot;
        paintedPose={...pose};canvas.dataset.pageTheme=String(pose.pageTheme);}),
      getPose:()=>({...pose}),getPageTheme:()=>pose.pageTheme,
      hasPageSnapshot:next=>snapshot===next,
      setPageSnapshot:vi.fn((next,{pageTheme=1,redraw=true}={})=>{snapshot=next;pose.pageTheme=pageTheme;
        if(redraw)view.draw(pose);return true;}),
      commitPreparedPage:vi.fn((next,{pageTheme=pose.pageTheme}={})=>
        snapshot===next&&paintedSnapshot===next&&paintedPose?.pageTheme===pageTheme&&
        Object.keys(pose).every(key=>pose[key]===paintedPose[key])),
      setPageTheme:mix=>view.draw({...pose,pageTheme:mix}),
      animate:frames=>{view.draw({...pose,...frames.at(-1).transform});return done();},
      animateCoverOpen:vi.fn(done),animateBookmark:done,
      pageTextures:()=>[],compilePage(){},uploadPageTexture(){},dispose(){}
    };
    view.draw(pose);views.push(view);return view;
  }
}));
let shelf;
afterEach(()=>{shelf?.destroy();shelf=null;document.body.innerHTML='';views.length=0;vi.unstubAllGlobals();});

async function select() {
  vi.stubGlobal('matchMedia',query=>({matches:/reduce/.test(query),addEventListener(){},removeEventListener(){}}));
  const container=document.createElement('div');document.body.append(container);
  const book={id:'prepared-page',title:'Night PDF',format:'PDF'};
  const snapshot={source:document.createElement('canvas'),paper:{source:document.createElement('canvas')}};
  let before,observed;
  shelf=renderBookshelf(container,[book],{shelfWidth:390,revealDuration:0,holdMs:0,autoOpen:true,
    onOpenBook:async(_book,context)=>{
      const view=views.at(-1);
      view.animateCoverOpen.mockImplementationOnce(()=>{
        observed={draws:view.draw.mock.calls.length-before,theme:canvas.dataset.pageTheme,
          phase:document.querySelector('.ihr-flyout').dataset.openingPhase};
        return{finished:Promise.resolve(),cancel(){}};
      });
      return context.finish({pageSnapshot:snapshot});
    }});
  container.querySelector('.ihr-spine').click();
  await vi.waitFor(()=>expect(document.querySelector('.ihr-flyout__cover-target.is-ready')).toBeTruthy());
  const view=views.at(-1),canvas=view.canvas;
  return{book,snapshot,view,tap:async()=>{before=view.draw.mock.calls.length;
    document.querySelector('.ihr-flyout__cover-target').click();await vi.waitFor(()=>expect(observed).toBeTruthy());
    return observed;}};
}

describe('opening commits a fully warmed page while preserving the fallback draw',()=>{
  it('starts the unchanged opening phase without redrawing the already painted white page',async()=>{
    const {book,snapshot,view,tap}=await select();
    await expect(shelf.prepareOpeningPage(book.id,snapshot,()=>Promise.resolve())).resolves.toBe(true);
    expect(view.canvas.dataset.pageTheme).toBe('0');
    expect(await tap()).toEqual({draws:0,theme:'0',phase:'opening'});
    expect(view.commitPreparedPage).toHaveBeenCalledWith(snapshot,{pageTheme:0});
    expect(view.setPageSnapshot).toHaveBeenCalledTimes(1);
  });
  it('draws exactly once when the installed white page warm-up was interrupted',async()=>{
    const {book,snapshot,view,tap}=await select();let release;
    const warming=shelf.prepareOpeningPage(book.id,snapshot,()=>new Promise(resolve=>{release=resolve;}));
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    expect(view.canvas.dataset.pageTheme).toBe('1');
    expect(await tap()).toEqual({draws:1,theme:'0',phase:'opening'});
    release();await expect(warming).resolves.toBe(false);
    expect(view.setPageSnapshot).toHaveBeenCalledTimes(1);
  });
  it('keeps the exact original draw for views without the new explicit commit API',async()=>{
    const {book,snapshot,view,tap}=await select();
    await shelf.prepareOpeningPage(book.id,snapshot,()=>Promise.resolve());delete view.commitPreparedPage;
    expect(await tap()).toEqual({draws:1,theme:'0',phase:'opening'});
    expect(view.setPageSnapshot).toHaveBeenCalledTimes(1);
  });
});
