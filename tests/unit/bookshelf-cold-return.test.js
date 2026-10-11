import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';
import { analyzeCoverAppearance } from '../../src/js/cover-appearance.js';

const calls = vi.hoisted(() => ({ scenes:[], views:[] }));
vi.mock('../../src/js/bookshelf-scene.js', () => ({ createBookshelfScene(layout) {
  const scene = { layout, initialAway:layout.entries.filter(entry => entry.book).map(entry => entry.node.classList.contains('is-away')),
    setPaintHeld:vi.fn(), setModalBackgroundDeferred:vi.fn(), setPresentationActive:vi.fn(),
    flush:vi.fn(), getInspectionZoom:() => 1, getBookPose:() => null, getReturnPose:() => null,
    updateEntry:vi.fn(), updateLayout:vi.fn(), dispose:vi.fn() };
  calls.scenes.push(scene); return scene;
} }));
vi.mock('../../src/js/book-model.js', () => ({
  getBookRenderer:() => ({}),
  planReadingBookPose:() => ({ x:0, y:0, scale:1, angle:0, pitch:0, coverOpen:1 }),
  bookView(host, book, style, dimensions) {
    const canvas = document.createElement('canvas'); host.append(canvas);
    let pose = { ...dimensions.initialPose, pageTheme:1 };
    const done = () => ({ finished:Promise.resolve(), cancel() {} });
    const view = { canvas, book, style, ready:Promise.resolve(), dimensions,
      draw:next => { pose = { ...pose, ...next }; }, getPose:() => pose, getPageTheme:() => pose.pageTheme,
      setPageTheme:value => { pose.pageTheme = value; }, deferDrawing() {}, setCompactReturnFrame() {},
      setPageSnapshot:vi.fn(() => true), alignToPage:vi.fn(() => true), updateBookmark() {},
      animate:done, animateBookmark:done, animateCoverClose:vi.fn(done), dispose:vi.fn(() => canvas.remove()) };
    calls.views.push(view); return view;
  }
}));
vi.mock('../../src/js/cover-appearance.js', async importOriginal => ({
  ...await importOriginal(), analyzeCoverAppearance:vi.fn(), readCoverAspectRatio:vi.fn(async () => .74)
}));

const appearance = { color:'#3b5268', shade:'#293b4c', ink:'#fffaf0', aspectRatio:.74,
  fontFamily:'Lora', fontCanvasFamily:'Lora', source:'cover' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
let shelf, container, book, firstAnalysis, frames, width, geometry, overlay;
async function flushMicrotasks() { for (let count=0; count<12; count++) await Promise.resolve(); }
async function paintShelf() {
  await flushMicrotasks();
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(performance.now());
  await flushMicrotasks();
}
function create(options = {}) {
  shelf = renderBookshelf(container,[book],{ get shelfWidth() { return width; }, sections:false,
    waitForCoverAppearance:true, coverSrcFor:() => 'blob:cold-return',
    getBookGeometryState:() => geometry, ...options });
  return shelf;
}
function begin() {
  const snapshot = { source:document.createElement('canvas'), width:374, height:561,
    displayBounds:{ left:8, top:48, width:374, height:561 } };
  overlay = document.createElement('div'); overlay.className='ihr-reader-return-page'; overlay.append(snapshot.source);
  document.body.append(overlay);
  const handoff=vi.fn(() => {
    expect(overlay.isConnected).toBe(true);
    expect(calls.views.at(-1).setPageSnapshot).toHaveBeenCalledWith(snapshot);
    expect(calls.views.at(-1).alignToPage).toHaveBeenCalledWith(snapshot.displayBounds);
  });
  let settled=false;
  // Same ownership as app.js: its finally removes the still page when this
  // promise resolves. Before the fix a missing cold slot resolved false here.
  const result=shelf.returnToShelf(book.id,{ book, pageSnapshot:snapshot, onPageReady:handoff })
    .finally(() => { settled=true; overlay.remove(); });
  return { result, handoff, settled:() => settled };
}
beforeEach(() => {
  calls.scenes.length=0; calls.views.length=0; frames=new Map(); width=390; geometry='ready';
  localStorage.clear(); localStorage.setItem('inhouse-read-shelf-plants','[]');
  let serial=0;
  vi.stubGlobal('WebGLRenderingContext',function() {});
  vi.stubGlobal('requestAnimationFrame',callback => { const id=++serial; frames.set(id,callback); return id; });
  vi.stubGlobal('cancelAnimationFrame',id => frames.delete(id));
  vi.stubGlobal('matchMedia',query => ({ matches:/reduce/.test(query), addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({ left:20, top:100,
    width:28, height:160, right:48, bottom:260, x:20, y:100 });
  firstAnalysis=deferred();
  vi.mocked(analyzeCoverAppearance).mockReset().mockResolvedValue(appearance).mockReturnValueOnce(firstAnalysis.promise);
  container=document.createElement('div'); document.body.append(container);
  book={ id:'cold-return', title:'A cold native import', format:'PDF', cover:'blob:cold-return' };
});
afterEach(() => {
  shelf?.destroy(); shelf=null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('cold return waits for its real semantic slot', () => {
  it('keeps the still page until cover analysis AND the semantic render, then closes the real page', async () => {
    create(); const returning=begin();
    await flushMicrotasks();
    expect(container.querySelector('.ihr-library-loading')).not.toBeNull();
    expect(container.querySelector('.ihr-spine')).toBeNull();
    expect(returning.settled()).toBe(false); expect(overlay.isConnected).toBe(true);
    expect(returning.handoff).not.toHaveBeenCalled(); expect(calls.scenes).toHaveLength(0);
    firstAnalysis.resolve(appearance); await flushMicrotasks();
    expect(returning.settled()).toBe(false); expect(overlay.isConnected).toBe(true);
    expect(calls.scenes).toHaveLength(0); // a resolved analysis is not a rendered slot
    await paintShelf();
    await expect(returning.result).resolves.toBe(true);
    // Existing return contract notifies at page alignment and again at flight;
    // the app's handoff is idempotent. Both calls must retain the source.
    expect(returning.handoff).toHaveBeenCalledTimes(2);
    expect(calls.scenes[0].layout.initialPaintHeld).toBeUndefined();
    expect(calls.scenes[0].initialAway).toEqual([false]);
    expect(calls.scenes[0].setPaintHeld).toHaveBeenCalledWith(false);
    expect(calls.views.at(-1).style.color).toBe(appearance.color);
    expect(calls.views.at(-1).animateCoverClose).toHaveBeenCalledOnce();
    expect(container.querySelector('.ihr-spine').classList.contains('is-away')).toBe(false);
  });

  it.each(['destroy','close','marker','viewport'])('cancels pending readiness on %s without a late return or hidden slot', async reason => {
    create(); shelf.setReturningBook(book.id); const returning=begin(); await flushMicrotasks();
    if(reason==='destroy') shelf.destroy();
    if(reason==='close') await shelf.close();
    if(reason==='marker') shelf.setReturningBook(null);
    if(reason==='viewport') window.dispatchEvent(new Event('resize'));
    await expect(returning.result).resolves.toBe(false);
    firstAnalysis.resolve(appearance); await paintShelf();
    expect(returning.handoff).not.toHaveBeenCalled(); expect(calls.views).toHaveLength(0);
    expect(document.querySelector('.ihr-flyout--return')).toBeNull();
    if(reason==='destroy') expect(calls.scenes).toHaveLength(0);
    else {
      expect(calls.scenes[0].layout.initialPaintHeld).toBeUndefined();
      expect(calls.scenes[0].initialAway).toEqual([false]);
    }
  });

  it('does not wait for a cover when word-count geometry is not ready', async () => {
    geometry='running'; create(); const returning=begin();
    await expect(returning.result).resolves.toBe(false);
    expect(returning.handoff).not.toHaveBeenCalled();
    geometry='ready'; firstAnalysis.resolve(appearance); await paintShelf();
    expect(calls.scenes[0].layout.initialPaintHeld).toBeUndefined();
    expect(calls.scenes[0].initialAway).toEqual([false]);
  });

  it.each(['removed','geometry'])('cancels if the pending return becomes %s while its cover is loading', async reason => {
    create(); shelf.setReturningBook(book.id); const returning=begin(); await flushMicrotasks();
    if(reason==='geometry') geometry='running';
    shelf.update(reason==='removed' ? [] : [book]);
    await expect(returning.result).resolves.toBe(false);
    firstAnalysis.resolve(appearance); await paintShelf();
    expect(returning.handoff).not.toHaveBeenCalled(); expect(calls.views).toHaveLength(0);
    expect(calls.scenes.every(scene => scene.layout.initialPaintHeld===undefined)).toBe(true);
  });

  it('releases a hidden zero-width destination instead of leaving a pending return forever', async () => {
    create(); const returning=begin(); await flushMicrotasks();
    width=0; firstAnalysis.resolve(appearance); await paintShelf();
    await expect(returning.result).resolves.toBe(false);
    expect(returning.handoff).not.toHaveBeenCalled();
    width=390; shelf.update([book]);
    expect(calls.scenes[0].layout.initialPaintHeld).toBeUndefined();
    expect(calls.scenes[0].initialAway).toEqual([false]);
  });

  it('releases the gate after a rejected cover and still returns using its normal fallback appearance', async () => {
    create(); const returning=begin(); await flushMicrotasks();
    firstAnalysis.reject(new Error('Cannot decode cover')); await paintShelf();
    await expect(returning.result).resolves.toBe(true);
    expect(returning.handoff).toHaveBeenCalledTimes(2);
  });
});
