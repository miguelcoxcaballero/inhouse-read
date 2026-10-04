import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';
import { canAdoptShelfMetadata } from '../../src/js/shelf-metadata-records.js';

const state = vi.hoisted(() => ({ layout:null, updates:0, adoption:vi.fn(), views:[] }));
vi.mock('../../src/js/bookshelf-scene.js', () => ({ createBookshelfScene(layout) {
  state.layout = layout;
  return {
    adoptMetadataRecords(previous, next) {
      state.adoption(previous, next);
      if (!canAdoptShelfMetadata(previous, next)) return false;
      for (const old of previous) if (state.layout.entries.find(entry => entry.book?.id === old.id)?.book !== old) return false;
      for (const book of next) state.layout.entries.find(entry => entry.book?.id === book.id).book = book;
      return true;
    },
    updateLayout(next) { state.layout = next; state.updates++; },
    getInspectionZoom:() => 1, setPresentationActive() {}, setPaintHeld() {}, flush:() => false,
    getObjectAtPoint:() => state.layout.entries.find(entry => entry.book)?.node,
    setDropPosition() {}, previewPlacements() {}, setTrashHover() {},
    getBookAtPoint:() => state.layout.entries.find(entry => entry.book)?.node,
    getBookPose:() => ({ centerX:45, centerY:200, width:100, height:160, thickness:28, scale:.7, angle:90, pitch:0, roll:0 }),
    getReturnPose:() => ({ centerX:45, centerY:200, width:100, height:160, thickness:28, scale:.7, angle:90, pitch:0, roll:0 }),
    returnBook:() => ({ finished:Promise.resolve(true), cancel() {} }),
    updateEntry(node, book) { state.layout.entries.find(entry => entry.node === node).book = book; },
    dispose() {}
  };
} }));
vi.mock('../../src/js/book-model.js', () => ({
  getBookRenderer:() => ({}), fitCoverImage:vi.fn(),
  planReadingBookPose:() => ({ x:0, y:0, scale:1, angle:0, pitch:0, coverOpen:1 }),
  bookView(host, book, _style, dimensions) {
    const canvas = document.createElement('canvas'); host.append(canvas);
    let pose = { ...dimensions.initialPose, pageTheme:1 }, snapshot;
    const done = () => ({ finished:Promise.resolve(), cancel() {} });
    const view = { canvas, book, ready:Promise.resolve(), dimensions,
      draw(next) { pose = { ...pose, ...next }; }, getPose:() => ({ ...pose }), getPageTheme:() => pose.pageTheme,
      setPageTheme(value) { pose.pageTheme = value; }, releaseToSnapshot() {}, deferDrawing() {}, setCompactReturnFrame() {},
      hasPageSnapshot:next => snapshot === next, setPageSnapshot(next) { snapshot = next; return true; }, alignToPage:() => true,
      prepareReturnAppearance:async () => true, updateBookmark:vi.fn(),
      animate(frames) { view.draw({ ...pose, ...frames.at(-1).transform }); return done(); },
      animateCoverOpen() { view.draw({ ...pose, coverOpen:1 }); return done(); },
      animateCoverClose() { view.draw({ ...pose, coverOpen:0 }); return done(); }, animateBookmark:done,
      handoffToShelfInsertion:start => start({ canvas }), dispose:() => canvas.remove() };
    state.views.push(view); return view;
  }
}));

let shelf, container, records, frames, clock, serial;
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
const spine = id => container.querySelector(`.ihr-spine[data-book-id="${id}"]`);
const meta = (book, fields = {}) => ({ ...book, progressDirty:false, progressUpdatedAt:12, ...fields });
const microtasks = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function frame() { clock += 16; const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(clock); }
async function until(predicate) {
  let count = 0;
  while (!predicate() && count++ < 120) { await microtasks(); if (frames.size) frame(); }
  expect(predicate()).toBe(true);
}
const snapshot = () => ({ source:document.createElement('canvas'), paper:{ source:document.createElement('canvas') },
  displayBounds:{ left:8, top:48, width:374, height:561 }, width:374, height:561 });
async function mount(options = {}) {
  shelf?.destroy(); frames.clear(); state.layout = null; state.updates = 0; state.adoption.mockClear(); state.views = [];
  records = ['a', 'b'].map(id => ({ id:`metadata:${id}`, title:`Book ${id}`, author:'Reader', format:'PDF',
    sourceType:'local', progressFraction:.37, locator:{ page:4 }, wordCount:78000, progressDirty:true, progressUpdatedAt:11 }));
  shelf = renderBookshelf(container, records, { shelfWidth:390, sections:false, sort:'none', adoptMetadata:true,
    revealDuration:0, holdMs:0, ...options });
  for (const book of records) spine(book.id).getBoundingClientRect = () => ({ left:20, top:100, width:28, height:160, right:48, bottom:260 });
  await microtasks();
  expect(frames.size).toBe(0);
}
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('inhouse-read-shelf-plants', '[]');
  frames = new Map(); clock = serial = 0;
  vi.stubGlobal('WebGLRenderingContext', function() {});
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('matchMedia', query => ({ matches:/reduce/.test(query), addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(document, 'fonts', { configurable:true, value:{ ready:new Promise(() => {}) } });
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => {
  shelf?.destroy(); shelf = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (fonts) Object.defineProperty(document, 'fonts', fonts); else delete document.fonts;
  if (originalDpr) Object.defineProperty(window, 'devicePixelRatio', originalDpr); else delete window.devicePixelRatio;
});

describe('production metadata reference adoption', () => {
  it('keeps nodes/labels/scene/model inputs and opens with the current references after metadata adoption', async () => {
    const coverSrcFor = vi.fn(() => null), onPrepareBook = vi.fn();
    await mount({ coverSrcFor, onPrepareBook });
    const original = records.map(book => spine(book.id)), labels = original.map(node => node.getAttribute('aria-label'));
    const latest = records.map(book => meta(book, { readingHistory:[{ locator:{ page:5 }, fraction:.37 }] }));
    shelf.refresh(latest);
    expect(state.updates).toBe(0); expect(state.adoption).toHaveBeenCalledOnce();
    for (let i = 0; i < latest.length; i++) {
      expect(spine(latest[i].id)).toBe(original[i]); expect(original[i].getAttribute('aria-label')).toBe(labels[i]);
      expect(state.layout.entries.find(entry => entry.book?.id === latest[i].id).book).toBe(latest[i]);
    }
    coverSrcFor.mockClear();
    original[0].dispatchEvent(new MouseEvent('pointerdown', { button:0, clientX:20, clientY:100 }));
    await microtasks(); expect(coverSrcFor).toHaveBeenCalledWith(latest[0]);
    original[0].dispatchEvent(new MouseEvent('pointerup', { button:0 })); original[0].click();
    expect(onPrepareBook).toHaveBeenCalledWith(latest[0], expect.any(Object));
    await until(() => Boolean(document.querySelector('.ihr-flyout__cover-target.is-ready')));
    expect(state.views.at(-1).book).toBe(latest[0]);
  });
  it('requires explicit opt-in and the exact production section/sort/text contract', async () => {
    for (const options of [{ adoptMetadata:false }, { adoptMetadata:undefined }, { sections:true }, { sort:'recent' },
      { texts:{ openAria:book => `History: ${book.readingHistory?.length || 0}` } }]) {
      await mount(options); const previous = spine(records[0].id);
      shelf.refresh(records.map(book => meta(book)));
      expect(state.adoption).not.toHaveBeenCalled(); expect(state.updates).toBe(1);
      expect(spine(records[0].id)).not.toBe(previous);
    }
  });
  it('uses the original layout for visual/unknown/content/cloud/order changes', async () => {
    for (const fields of [{ title:'New visible title' }, { progressFraction:.8 }, { futureFlag:true },
      { content:new Blob(['downloaded']) }, { driveFileId:'uploaded-copy' }, { cloudAccountId:'another-account' },
      { cover:new Blob(['new cover']) }, { wordCount:81000 }, { lastOpenedAt:33 }, { shelfOrder:2 },
      { shelfPosition:{ shelf:1, x:.4 } }]) {
      await mount(); const previous = spine(records[0].id), latest = records.map(book => meta(book));
      latest[0] = { ...latest[0], ...fields }; shelf.refresh(latest);
      expect(state.adoption).not.toHaveBeenCalled(); expect(state.updates).toBe(1);
      expect(spine(records[0].id)).not.toBe(previous);
      expect(state.layout.entries.find(entry => entry.book?.id === latest[0].id).book).toBe(latest[0]);
    }
    await mount(); const previous = spine(records[0].id);
    shelf.refresh(records.map(book => meta(book)).reverse());
    expect(state.adoption).not.toHaveBeenCalled(); expect(state.updates).toBe(1); expect(spine(records[0].id)).not.toBe(previous);
  });
  it('preserves deferred scheduling and replaces a pending list with a synchronous genuine update', async () => {
    await mount(); const node = spine(records[0].id), queued = records.map(book => meta(book));
    shelf.queueRefresh(queued);
    expect(frames.size).toBe(1); expect(state.adoption).not.toHaveBeenCalled(); expect(state.updates).toBe(0);
    expect(spine(records[0].id)).toBe(node);
    const actual = queued.map(book => ({ ...book, title:`Updated ${book.title}` })); shelf.refresh(actual);
    expect(frames.size).toBe(0); expect(state.adoption).not.toHaveBeenCalled(); expect(state.updates).toBe(1);
    frame(); expect(state.updates).toBe(1);
    expect(spine(records[0].id).getAttribute('aria-label')).toContain(actual[0].title);
  });
  it('adopts the last complete queued metadata list on its actual scheduled frame, retaining nodes and current opening references', async () => {
    const onPrepareBook = vi.fn(); await mount({ onPrepareBook });
    const nodes = records.map(book => spine(book.id));
    const first = records.map(book => meta(book));
    const latest = records.map(book => meta(book, { progressUpdatedAt:13, locator:{ page:9 }, readingHistory:[{ fraction:.37, locator:{ page:9 } }] }));
    shelf.queueRefresh(first); shelf.queueRefresh(latest);
    expect(frames.size).toBe(1); expect(state.adoption).not.toHaveBeenCalled(); expect(state.updates).toBe(0);
    for (const book of records) expect(state.layout.entries.find(entry => entry.book?.id === book.id).book).toBe(book);
    frame();
    expect(frames.size).toBe(0); expect(state.adoption).toHaveBeenCalledWith(records, latest); expect(state.updates).toBe(0);
    for (let i = 0; i < latest.length; i++) {
      expect(spine(latest[i].id)).toBe(nodes[i]); expect(state.layout.entries.find(entry => entry.book?.id === latest[i].id).book).toBe(latest[i]);
    }
    // The original refresh owns a copy of the caller's membership/order.
    // Metadata adoption must retain that contract while refreshing records.
    const accepted = latest.slice(); latest.reverse(); latest.pop();
    const next = accepted.map(book => meta(book, { progressUpdatedAt:14 }));
    state.adoption.mockClear(); shelf.refresh(next);
    expect(state.adoption).toHaveBeenCalledWith(accepted, next); expect(state.updates).toBe(0);
    expect(state.layout.entries.filter(entry => entry.book).map(entry => entry.book.id)).toEqual(accepted.map(book => book.id));
    for (let i = 0; i < next.length; i++) {
      expect(spine(next[i].id)).toBe(nodes[i]); expect(state.layout.entries.find(entry => entry.book?.id === next[i].id).book).toBe(next[i]);
    }
    nodes[0].click(); expect(onPrepareBook).toHaveBeenCalledWith(next[0], expect.any(Object));
    await until(() => Boolean(document.querySelector('.ihr-flyout__cover-target.is-ready')));
    expect(state.views.at(-1).book).toBe(next[0]);
  });
  it('keeps pressure, presentation/viewport/geometry changes and a live selection on the original/deferred path', async () => {
    await mount(); spine(records[0].id).dispatchEvent(new MouseEvent('pointerdown', { button:0 }));
    const latest = records.map(book => meta(book)); shelf.refresh(latest);
    // A real pointerdown also starts the pending hold/drag session. A refresh
    // remains deferred until cancellation, rather than bypassing that guard.
    expect(state.updates).toBe(0); expect(state.adoption).not.toHaveBeenCalled();
    spine(records[0].id).dispatchEvent(new MouseEvent('pointercancel', { button:0 }));
    expect(state.layout.entries.find(entry => entry.book?.id === latest[0].id).book).toBe(latest[0]);
    await mount(); shelf.setPresentationActive(false); shelf.refresh(records.map(book => meta(book)));
    expect(state.updates).toBe(1); expect(state.adoption).not.toHaveBeenCalled();
    await mount(); Object.defineProperty(window, 'devicePixelRatio', { configurable:true, value:2 });
    shelf.refresh(records.map(book => meta(book))); expect(state.updates).toBe(1); expect(state.adoption).not.toHaveBeenCalled();
    Object.defineProperty(window, 'devicePixelRatio', { configurable:true, value:1 });
    let ready = true; await mount({ getBookGeometryState:() => ready ? 'ready' : 'pending' }); ready = false;
    shelf.refresh(records.map(book => meta(book))); expect(state.updates).toBe(1); expect(state.adoption).not.toHaveBeenCalled();
    await mount(); spine(records[0].id).click(); shelf.refresh(records.map(book => meta(book)));
    expect(state.updates).toBe(0); expect(state.adoption).not.toHaveBeenCalled();
    expect(shelf.element.querySelector('.ihr-spine')).not.toBeNull();
  });
  it('keeps the parked reader origin and passes current metadata into return preparation before presentation', async () => {
    await mount({ onOpenBook:(_book, context) => context.finish({ pageSnapshot:snapshot() }) });
    spine(records[0].id).click(); await until(() => Boolean(document.querySelector('.ihr-flyout__cover-target.is-ready')));
    document.querySelector('.ihr-flyout__cover-target').click(); await until(() => !document.querySelector('.ihr-flyout'));
    expect(shelf.hasReaderOrigin(records[0].id)).toBe(true);
    await microtasks(); const latest = records.map(book => meta(book, { locator:{ page:9 }, bookmarks:[{ locator:{ page:7 } }] }));
    const oldNode = spine(latest[0].id); shelf.refresh(latest);
    expect(spine(latest[0].id)).toBe(oldNode); expect(state.updates).toBe(0);
    let completed = false, result; const returning = shelf.returnToShelf(latest[0].id, { pageSnapshot:snapshot() }).then(value => { completed = true; result = value; });
    await until(() => completed); await returning; expect(result).toBe(true);
    expect(state.views.some(view => view.updateBookmark.mock.calls.some(([book]) => book === latest[0]))).toBe(true);
    expect(spine(latest[0].id).getAttribute('aria-label')).toContain('37 %');
  });
});
