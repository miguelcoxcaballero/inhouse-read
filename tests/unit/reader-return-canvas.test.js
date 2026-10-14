import './helpers/rust-ui-ready.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readerReturnCanvas } from '../../src/js/reader-return-canvas.js';
import { compositePageSnapshots, snapshotCanvas, snapshotDOMPage } from '../../src/js/readers/page-snapshot.js';

let contexts;
const dimensions = { left:0, top:0, width:19, height:31, right:19, bottom:31 };
const freshCanvas = () => Object.assign(document.createElement('canvas'), { width:19, height:31 });
beforeEach(() => {
  contexts = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    if (!contexts.has(this)) contexts.set(this, { drawImage:vi.fn(), fillRect:vi.fn(), scale:vi.fn(),
      beginPath:vi.fn(), rect:vi.fn(), clip:vi.fn() });
    return contexts.get(this);
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('the current page has one still-layer canvas and independent fallback ownership', () => {
  it('reuses a detached HTML canvas without requesting its context or resizing it', () => {
    const source = freshCanvas();
    const width = vi.spyOn(source, 'width', 'set'), height = vi.spyOn(source, 'height', 'set');
    expect(readerReturnCanvas(source, { reuseDetached:true })).toBe(source);
    expect(contexts.size).toBe(0);
    expect(width).not.toHaveBeenCalled(); expect(height).not.toHaveBeenCalled();
    expect(source.width).toBe(19); expect(source.height).toBe(31);
  });

  it('the default copy keeps the exact dimensions and original drawImage operation', () => {
    const source = freshCanvas(), copy = readerReturnCanvas(source);
    expect(copy).not.toBe(source);
    expect(copy.width).toBe(source.width); expect(copy.height).toBe(source.height);
    expect(contexts.get(copy).drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0);
    expect(source.parentNode).toBeNull();
  });

  it.each(['document', 'detached-parent', 'fragment'])('does not steal a canvas owned by a %s', kind => {
    const source = freshCanvas(), parent = kind === 'fragment' ? document.createDocumentFragment() : document.createElement('div');
    if (kind === 'document') document.body.append(parent);
    parent.append(source);
    const copy = readerReturnCanvas(source, { reuseDetached:true });
    expect(copy).not.toBe(source); expect(source.parentNode).toBe(parent);
    expect(contexts.get(copy).drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0);
  });

  it('copies non-DOM sources instead of appending an OffscreenCanvas or ImageBitmap', () => {
    const source = { width:29, height:43 }, copy = readerReturnCanvas(source, { reuseDetached:true });
    expect(copy).toBeInstanceOf(HTMLCanvasElement);
    expect(copy.width).toBe(29); expect(copy.height).toBe(43);
    expect(contexts.get(copy).drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0);
  });

  it('keeps the still page in place when the fallback acquires its own DOM page', () => {
    const source = freshCanvas(), overlay = document.createElement('div'), fallback = document.createElement('div');
    document.body.append(overlay, fallback);
    overlay.append(readerReturnCanvas(source, { reuseDetached:true }));
    fallback.append(readerReturnCanvas(source));
    expect(overlay.firstChild).toBe(source); expect(fallback.firstChild).not.toBe(source);
    expect(contexts.size).toBe(1);
    expect(contexts.get(fallback.firstChild).drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0);
    overlay.remove();
    expect(fallback.firstChild.width).toBe(19); expect(fallback.firstChild.height).toBe(31);
    expect(source.width).toBe(19); expect(source.height).toBe(31);
  });

  it('the physical PDF snapshot remains independent when the original reader is cleared', () => {
    const reader = document.createElement('div'), rendered = freshCanvas(); reader.append(rendered); document.body.append(reader);
    const snapshot = snapshotCanvas(rendered, { paper:true, displayBounds:dimensions });
    const canvas = readerReturnCanvas(snapshot.source, { reuseDetached:true });
    expect(canvas).not.toBe(rendered); expect(canvas).toBe(snapshot.source);
    const overlay = document.createElement('div'); overlay.append(canvas); document.body.append(overlay);
    const drawCalls = contexts.get(canvas).drawImage.mock.calls.length;
    rendered.width = 0; rendered.height = 0; reader.replaceChildren();
    expect(canvas.width).toBe(19); expect(canvas.height).toBe(31);
    expect(contexts.get(canvas).drawImage).toHaveBeenCalledTimes(drawCalls);
    expect(snapshot.paper.source).not.toBe(canvas);
  });

  it('the adaptive page snapshot is detached from the reflow document', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const snapshot = await snapshotDOMPage(root, { viewport:dimensions, paper:{background:'#fff',color:'#222',themeColor:'#222'} });
    expect(snapshot.source.parentNode).toBeNull();
    const overlay = document.createElement('div'); document.body.append(overlay);
    overlay.append(readerReturnCanvas(snapshot.source, { reuseDetached:true }));
    root.replaceChildren(); root.remove();
    expect(overlay.firstChild).toBe(snapshot.source); expect(snapshot.source.width).toBeGreaterThan(0);
    expect(contexts.get(snapshot.source).drawImage).not.toHaveBeenCalled();
  });

  it('the Foliate composite is independent from its frame snapshots', () => {
    const frame = { source:freshCanvas(), paper:{source:freshCanvas()}, text:'The current page' };
    const snapshot = compositePageSnapshots([frame], { viewport:dimensions, paperBackground:'#fff' });
    const canvas = readerReturnCanvas(snapshot.source, { reuseDetached:true });
    expect(canvas).toBe(snapshot.source); expect(canvas).not.toBe(frame.source);
    frame.source.width = 0; frame.paper.source.width = 0;
    expect(canvas.width).toBeGreaterThan(0); expect(snapshot.text).toBe('The current page');
    expect(contexts.get(canvas).drawImage).toHaveBeenCalledTimes(1);
  });
});
