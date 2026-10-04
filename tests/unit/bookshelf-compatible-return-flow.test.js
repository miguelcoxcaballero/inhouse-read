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
      prepareReturnAppearance:vi.fn(async () => true),
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


describe('shelf uses the explicit compatible return path',()=>{
 it('upgrades an HD cover on the same retained view before the first closing frame',async()=>{
  await openReader();const original=lifted()[0],latest={...book,cover:'blob:HD',progressFraction:.8};
  const observed=[];
  await expect(shelf.returnToShelf(book.id,{book:latest,pageSnapshot:snapshot(),onPageReady:()=>observed.push(document.querySelector('.ihr-flyout--return').dataset.returnView)})).resolves.toBe(true);
  expect(lifted()).toHaveLength(1);expect(original.prepareReturnAppearance).toHaveBeenCalledOnce();
  expect(original.prepareReturnAppearance.mock.calls[0][0]).toEqual(latest);
  expect(original.prepareReturnAppearance.mock.calls[0][2]).toBe('blob:HD');
  expect(original.updateBookmark).toHaveBeenCalledExactlyOnceWith(latest);expect(observed.every(value=>value==='reused')).toBe(true);
  expect(original.dispose).toHaveBeenCalledOnce();
 });
 it('disposes a failed upgrade and starts the existing fresh-view fallback',async()=>{
  await openReader();const original=lifted()[0];original.prepareReturnAppearance.mockResolvedValue(false);
  await expect(shelf.returnToShelf(book.id,{book:{...book,cover:'blob:bad-HD'},pageSnapshot:snapshot()})).resolves.toBe(true);
  expect(lifted()).toHaveLength(2);expect(original.dispose).toHaveBeenCalledOnce();expect(lifted()[1].dispose).toHaveBeenCalledOnce();
 });
});
