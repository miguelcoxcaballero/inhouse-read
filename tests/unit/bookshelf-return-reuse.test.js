import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';

const views = vi.hoisted(() => []);
vi.mock('../../src/js/book-model.js',() => ({
  getBookRenderer:() => null,
  planReadingBookPose:() => ({ x:0,y:0,scale:1,angle:0,pitch:0,coverOpen:1 }),
  bookView(host,_book,_style,dimensions) {
    const canvas = document.createElement('canvas'); host.append(canvas);
    let pose = { ...dimensions.initialPose,pageTheme:1 }, snapshot;
    const paints = [];
    const done = () => ({ finished:Promise.resolve(),cancel() {} });
    const view = {
      canvas,ready:Promise.resolve(),dimensions,paints,
      draw:vi.fn((next,options) => {
        paints.push({ connected:canvas.isConnected,redraw:options?.redraw !== false,
          restingBookAway:document.querySelector('.ihr-spine')?.classList.contains('is-away') });
        pose = { ...pose,...next };
      }),
      getPose:() => ({ ...pose }),getPageTheme:() => pose.pageTheme,
      setPageTheme:value => { pose.pageTheme = value; },
      hasPageSnapshot:next => snapshot === next,
      setPageSnapshot:vi.fn(next => { snapshot = next; return true; }),alignToPage:vi.fn(() => true),
      updateBookmark:vi.fn(() => true),
      animate:vi.fn(frames => { view.draw({ ...pose,...frames.at(-1).transform }); return done(); }),
      animateCoverOpen:vi.fn(() => { view.draw({ ...pose,coverOpen:1 }); return done(); }),
      animateCoverClose:vi.fn(() => { view.draw({ ...pose,coverOpen:0 }); return done(); }),
      animateBookmark:vi.fn(done),
      dispose:vi.fn(() => canvas.remove())
    };
    views.push(view); return view;
  }
}));

let shelf,container,book;
const lifted = () => views.filter(view => !view.dimensions.shelf);
const snapshot = () => ({ source:document.createElement('canvas'),paper:{ source:document.createElement('canvas') },
  displayBounds:{ left:8,top:48,width:374,height:561 },width:374,height:561 });
const stubSpine = () => {
  const node = container.querySelector('.ihr-spine');
  node.getBoundingClientRect = () => ({ left:20,top:100,width:28,height:160,right:48,bottom:260 });
  return node;
};
async function openReader() {
  stubSpine().click();
  await vi.waitFor(() => expect(document.querySelector('.ihr-flyout__cover-target.is-ready')).not.toBeNull());
  document.querySelector('.ihr-flyout__cover-target').click();
  await vi.waitFor(() => expect(document.querySelector('.ihr-flyout')).toBeNull());
  expect(shelf.hasReaderOrigin(book.id)).toBe(true);
}
beforeEach(() => {
  views.length = 0; localStorage.clear();
  vi.stubGlobal('matchMedia',query => ({ matches:/reduce/.test(query),addEventListener() {},removeEventListener() {} }));
  container = document.createElement('div'); document.body.append(container);
  book = { id:'return-reuse',title:'The same case',author:'Reader',format:'PDF',progressFraction:.1 };
  shelf = renderBookshelf(container,[book],{ shelfWidth:390,sections:false,revealDuration:0,holdMs:0,
    onOpenBook:(_book,context) => context.finish({ pageSnapshot:snapshot() }) });
});
afterEach(() => { shelf.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('reader close reuses its exact lifted book',() => {
  it('prepares detached opening poses without painting and draws the ready book before hiding its resting spine',async () => {
    stubSpine().click();
    await vi.waitFor(() => expect(document.querySelector('.ihr-flyout__cover-target.is-ready')).not.toBeNull());
    const original = lifted()[0];
    expect(original.dimensions.deferDraw).toBe(true);
    expect(original.dimensions.compactReturnFrame).toBe(true);
    const detached = original.paints.filter(paint => !paint.connected);
    expect(detached.length).toBeGreaterThan(0);
    expect(detached.every(paint => !paint.redraw)).toBe(true);
    const firstPaint = original.paints.find(paint => paint.redraw);
    expect(firstPaint).toEqual({ connected:true,redraw:true,restingBookAway:false });
    expect(stubSpine().classList.contains('is-away')).toBe(true);
  });
  it('retains one ready view at handoff, refreshes final bookmark and paints the saved themed page before flight',async () => {
    await openReader();
    const original = lifted()[0], closingPage = snapshot();
    expect(original.dispose).not.toHaveBeenCalled();
    const latest = { ...book,progressFraction:.8,locator:9,lastOpenedAt:400,progressUpdatedAt:400,progressDirty:true };
    const observations = [];
    await expect(shelf.returnToShelf(book.id,{ book:latest,pageSnapshot:closingPage,onPageReady:() => {
      observations.push({ canvas:document.querySelector('.ihr-flyout--return canvas'),reuse:document.querySelector('.ihr-flyout--return').dataset.returnView });
    } })).resolves.toBe(true);
    expect(lifted()).toHaveLength(1);
    expect(original.updateBookmark).toHaveBeenCalledExactlyOnceWith(latest);
    expect(original.setPageSnapshot).toHaveBeenLastCalledWith(closingPage);
    expect(original.alignToPage).toHaveBeenCalledExactlyOnceWith(closingPage.displayBounds);
    expect(observations.every(value => value.canvas === original.canvas && value.reuse === 'reused')).toBe(true);
    expect(original.animateCoverClose).toHaveBeenCalledOnce();
    expect(original.dispose).toHaveBeenCalledOnce();
    expect(shelf.hasReaderOrigin(book.id)).toBe(false);
    expect(document.querySelector('.ihr-flyout')).toBeNull();
    expect(stubSpine().classList.contains('is-away')).toBe(false);
  });
  it('an edited case rejects and releases the retained view before creating the correct replacement',async () => {
    await openReader(); const original = lifted()[0];
    await expect(shelf.returnToShelf(book.id,{ book:{ ...book,coverFinish:'glossy' },pageSnapshot:snapshot() })).resolves.toBe(true);
    expect(lifted()).toHaveLength(2);
    expect(original.dispose).toHaveBeenCalledOnce();
    expect(original.updateBookmark).not.toHaveBeenCalled();
    expect(lifted()[1].dispose).toHaveBeenCalledOnce();
  });
  it('a return without a captured page starts a newly closed case instead of flying an open old model',async () => {
    await openReader(); const original = lifted()[0];
    await expect(shelf.returnToShelf(book.id)).resolves.toBe(true);
    expect(lifted()).toHaveLength(2);
    expect(original.dispose).toHaveBeenCalledOnce();
    expect(lifted()[1].dimensions.initialPose.coverOpen).toBe(0);
    expect(lifted()[1].animateCoverClose).not.toHaveBeenCalled();
  });
  it('destroy releases the detached book even when the reader never closes',async () => {
    await openReader(); const original = lifted()[0];
    shelf.destroy();
    expect(original.dispose).toHaveBeenCalledOnce();
  });
});
