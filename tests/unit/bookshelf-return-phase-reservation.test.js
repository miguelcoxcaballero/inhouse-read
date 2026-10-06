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
      canvas,ready:Promise.resolve(),dimensions,paints,reserved:0,releaseTokens:[],phaseEvents:[],
      holdNativeMotionFrame:vi.fn(() => {
        view.reserved++;
        const release=vi.fn(() => { view.reserved--;view.phaseEvents.push({kind:'release',phase:document.querySelector('.ihr-flyout--return')?.dataset.returnPhase}); });
        view.releaseTokens.push(release);return release;
      }),
      draw:vi.fn((next,options) => {
        paints.push({ connected:canvas.isConnected,redraw:options?.redraw !== false,
          restingBookAway:document.querySelector('.ihr-spine')?.classList.contains('is-away') });
        pose = { ...pose,...next };
      }),
      getPose:() => ({ ...pose }),getPageTheme:() => pose.pageTheme,
      setPageTheme:value => { view.phaseEvents.push({kind:'theme',reserved:view.reserved});pose.pageTheme = value; },
      hasPageSnapshot:next => snapshot === next,
      setPageSnapshot:vi.fn(next => { snapshot = next; return true; }),alignToPage:vi.fn(() => true),
      updateBookmark:vi.fn(() => true),
      animate:vi.fn(frames => { view.phaseEvents.push({kind:document.querySelector('.ihr-flyout--return')?.dataset.returnPhase || 'opening',reserved:view.reserved});view.draw({ ...pose,...frames.at(-1).transform }); return done(); }),
      animateCoverOpen:vi.fn(() => { view.draw({ ...pose,coverOpen:1 }); return done(); }),
      animateCoverClose:vi.fn(() => { view.phaseEvents.push({kind:'hinge',reserved:view.reserved});view.draw({ ...pose,coverOpen:0 }); return done(); }),
      animateBookmark:vi.fn(() => { view.phaseEvents.push({kind:'ribbon',reserved:view.reserved});return done(); }),
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


const begin=async()=>{await openReader();const view=lifted()[0];expect(view.reserved).toBe(0);view.phaseEvents.length=0;view.releaseTokens.length=0;return view;};
const releasedOnce=view=>{expect(view.reserved).toBe(0);expect(view.releaseTokens).toHaveLength(1);expect(view.releaseTokens[0]).toHaveBeenCalledOnce();};
describe('reader return releases the zoom reservation at the phase boundary',()=>{
 it('holds the exact page zoom then releases before ribbon, hinge and flight',async()=>{
  const view=await begin();await expect(shelf.returnToShelf(book.id,{pageSnapshot:snapshot()})).resolves.toBe(true);
  expect(view.phaseEvents).toEqual([{kind:'zooming',reserved:1},{kind:'release',phase:'zooming'},{kind:'ribbon',reserved:0},{kind:'hinge',reserved:0},{kind:'returning',reserved:0}]);
  releasedOnce(view);
 });
 it('releases before correcting a stalled page theme',async()=>{
  const view=await begin(),normal=view.animate.getMockImplementation();
  view.animate.mockImplementation(frames=>document.querySelector('.ihr-flyout--return')?.dataset.returnPhase==='zooming'
   ? {finished:Promise.resolve(),cancel(){}} : normal(frames));
  await expect(shelf.returnToShelf(book.id,{pageSnapshot:snapshot()})).resolves.toBe(true);
  expect(view.phaseEvents.slice(0,2)).toEqual([{kind:'release',phase:'zooming'},{kind:'theme',reserved:0}]);releasedOnce(view);
 });
 it('keeps the original reservation for a return without a saved page',async()=>{
  await begin();await expect(shelf.returnToShelf(book.id)).resolves.toBe(true);
  const view=lifted()[1];expect(view.phaseEvents[0]).toEqual({kind:'returning',reserved:1});releasedOnce(view);
 });
 it('releases through finally when alignment fails before zoom',async()=>{
  const view=await begin();view.alignToPage.mockReturnValue(false);
  await expect(shelf.returnToShelf(book.id,{pageSnapshot:snapshot()})).rejects.toThrow('alinear');releasedOnce(view);
  expect(view.animateBookmark).toHaveBeenCalledTimes(1); // opening only
 });
 it('releases through finally when creating the zoom throws',async()=>{
  const view=await begin(),error=new Error('zoom failed');view.animate.mockImplementation(()=>{throw error;});
  await expect(shelf.returnToShelf(book.id,{pageSnapshot:snapshot()})).rejects.toBe(error);releasedOnce(view);
 });
 it('releases once if the shelf is destroyed during zoom',async()=>{
  const view=await begin();view.animate.mockImplementation(()=>{shelf.destroy();return {finished:Promise.resolve(),cancel(){}};});
  await expect(shelf.returnToShelf(book.id,{pageSnapshot:snapshot()})).resolves.toBe(false);releasedOnce(view);
 });
});
