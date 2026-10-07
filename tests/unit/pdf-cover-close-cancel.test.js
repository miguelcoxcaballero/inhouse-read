import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getPage:vi.fn(), destroy:vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions:{}, OPS:{}, getDocument:() => ({ promise:Promise.resolve({ numPages:1,getPage:state.getPage }),destroy:state.destroy }),
  TextLayer:class { render = vi.fn(async () => {}); cancel = vi.fn(); }
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default:'worker.mjs' }));
vi.mock('../../src/js/gestures.js', () => ({ attachSwipeNavigation:() => () => {} }));
import { PdfReader } from '../../src/js/readers/pdf-reader.js';
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes;reject=no; });
  return { promise,resolve,reject };
};
let reader, page, encode, contexts;
beforeEach(async () => {
  contexts = new Map();
  document.body.innerHTML='<main></main>';
  const container=document.querySelector('main');
  container.getBoundingClientRect=()=>({ left:0,top:64,width:390,height:720,right:390,bottom:784 });
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function () {
    if(!contexts.has(this))contexts.set(this,{ canvas:this,clearRect:vi.fn(),drawImage:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),scale:vi.fn(),measureText:()=>({width:10}) });
    return contexts.get(this);
  });
  encode=vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['HD'],{type:'image/jpeg'})));
  vi.stubGlobal('requestAnimationFrame',callback=>{callback(0);return 1;});
  page={ getViewport:({scale})=>({width:300*scale,height:200*scale}),imageCoordinates:new Float32Array(),getOperatorList:async()=>({fnArray:[]}),
    getTextContent:async()=>({items:[{str:'Actual PDF page.',hasEOL:true}]}),render:vi.fn(()=>({promise:Promise.resolve(),cancel:vi.fn()})) };
  state.getPage.mockReset().mockResolvedValue(page); state.destroy.mockClear();
  reader=new PdfReader(); await reader.open(container,new ArrayBuffer(0));
  state.getPage.mockClear(); page.render.mockClear();
});
afterEach(()=>{reader.close();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
describe('optional PDF cover render cancellation', () => {
  it('keeps the original 900x600 raster, viewport and JPEG quality on success', async () => {
    const controller=new AbortController();
    const blob=await reader.getCoverBlob({signal:controller.signal});
    expect(blob.type).toBe('image/jpeg');
    expect(state.getPage).toHaveBeenCalledWith(1);
    const args=page.render.mock.calls[0][0];
    expect(args.viewport).toEqual({width:900,height:600});
    expect(args.canvasContext.canvas.width).toBe(900);expect(args.canvasContext.canvas.height).toBe(600);
    expect(encode).toHaveBeenCalledWith(expect.any(Function),'image/jpeg',0.9);
  });
  it('skips page retrieval, rendering and encoding when already aborted', async () => {
    const controller=new AbortController();controller.abort();
    expect(await reader.getCoverBlob({signal:controller.signal})).toBeNull();
    expect(state.getPage).not.toHaveBeenCalled();expect(page.render).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
  });
  it('does not start rendering after cancellation during page retrieval', async () => {
    const controller=new AbortController(), pending=deferred();state.getPage.mockReturnValueOnce(pending.promise);
    const cover=reader.getCoverBlob({signal:controller.signal});controller.abort();pending.resolve(page);
    expect(await cover).toBeNull();expect(page.render).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
  });
  it('cancels the actual PDF RenderTask once, removes its listener and avoids JPEG work', async () => {
    const controller=new AbortController(), pending=deferred(), cancel=vi.fn(()=>pending.reject(new Error('Rendering cancelled')));
    const remove=vi.spyOn(controller.signal,'removeEventListener');page.render.mockReturnValueOnce({promise:pending.promise,cancel});
    const cover=reader.getCoverBlob({signal:controller.signal});
    await vi.waitFor(()=>expect(page.render).toHaveBeenCalledOnce());controller.abort();
    pending.resolve(); // Both implementations settle; the control must fail an assertion, never hang.
    expect(cancel).toHaveBeenCalledOnce();
    expect(await cover).toBeNull();controller.abort();
    expect(cancel).toHaveBeenCalledOnce();expect(encode).not.toHaveBeenCalled();expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
  });
  it('discards an encoding result when cancellation arrives after the PDF render', async () => {
    const controller=new AbortController();let complete;
    encode.mockImplementationOnce(callback=>{complete=callback;});
    const cover=reader.getCoverBlob({signal:controller.signal});
    await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));controller.abort();complete(new Blob(['obsolete']));
    expect(await cover).toBeNull();expect(encode).toHaveBeenCalledOnce();
  });
  it('does not render a retrieved cover page after the original document closes', async () => {
    const pending=deferred();state.getPage.mockReturnValueOnce(pending.promise);
    const cover=reader.getCoverBlob();reader.close();pending.resolve(page);
    expect(await cover).toBeNull();expect(page.render).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
  });
  it('returns null for an aborted page retrieval rejection but preserves active PDF errors', async () => {
    const pending=deferred(), controller=new AbortController();state.getPage.mockReturnValueOnce(pending.promise);
    const cover=reader.getCoverBlob({signal:controller.signal});controller.abort();pending.reject(new Error('Document closed'));
    expect(await cover).toBeNull();
    const parseError=new Error('Invalid PDF page');state.getPage.mockRejectedValueOnce(parseError);
    await expect(reader.getCoverBlob()).rejects.toBe(parseError);
    expect(page.render).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
  });
});


describe('first PDF cover retained through a quick close', () => {
  it('keeps its own PDF alive through page retrieval and frees it when the cover finishes', async () => {
    const pending=deferred(); state.getPage.mockReturnValueOnce(pending.promise);
    const request=reader.getCoverBlob({retainOnClose:true}); reader.close();
    const earlyDestroy=state.destroy.mock.calls.length;
    pending.resolve(page); const blob=await request;
    expect(earlyDestroy).toBe(0); expect(blob?.type).toBe('image/jpeg');
    expect(state.destroy).toHaveBeenCalledOnce();
  });
  it('finishes an initial render after close without holding the reader UI open', async () => {
    const pending=deferred(); page.render.mockReturnValueOnce({promise:pending.promise,cancel:vi.fn()});
    const request=reader.getCoverBlob({retainOnClose:true});
    await vi.waitFor(()=>expect(page.render).toHaveBeenCalledOnce()); reader.close();
    const earlyDestroy=state.destroy.mock.calls.length;
    expect(document.querySelector('main').children.length).toBe(0);
    pending.resolve(); const blob=await request;
    expect(earlyDestroy).toBe(0); expect(blob?.type).toBe('image/jpeg');
    expect(state.destroy).toHaveBeenCalledOnce();
  });
  it('preserves a finished first-page raster while its JPEG encoder completes', async () => {
    let complete; encode.mockImplementationOnce(callback=>{complete=callback;});
    const request=reader.getCoverBlob({retainOnClose:true});
    await vi.waitFor(()=>expect(complete).toBeTypeOf('function')); reader.close();
    const earlyDestroy=state.destroy.mock.calls.length;
    const encoded=new Blob(['initial-cover'],{type:'image/jpeg'}); complete(encoded); const blob=await request;
    expect(earlyDestroy).toBe(0); expect(blob).toBe(encoded);
    expect(state.destroy).toHaveBeenCalledOnce();
  });
  it('still honours explicit cancellation and releases the detached document exactly once', async () => {
    const controller=new AbortController(),pending=deferred(),cancel=vi.fn(()=>pending.reject(new Error('cancelled')));
    page.render.mockReturnValueOnce({promise:pending.promise,cancel});
    const request=reader.getCoverBlob({signal:controller.signal,retainOnClose:true});
    await vi.waitFor(()=>expect(page.render).toHaveBeenCalledOnce()); reader.close();
    const earlyDestroy=state.destroy.mock.calls.length;
    controller.abort(); expect(await request).toBeNull(); reader.close();
    expect(earlyDestroy).toBe(0); expect(cancel).toHaveBeenCalledOnce();
    expect(state.destroy).toHaveBeenCalledOnce(); expect(encode).not.toHaveBeenCalled();
  });
});


describe('retained first-cover ownership',()=>{
 it('releases one captured PDF only after its last retained extraction finishes',async()=>{
  const first=deferred(),second=deferred();
  state.getPage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a=reader.getCoverBlob({retainOnClose:true}),b=reader.getCoverBlob({retainOnClose:true});
  reader.close(); const earlyDestroy=state.destroy.mock.calls.length;
  first.resolve(page); const coverA=await a; const middleDestroy=state.destroy.mock.calls.length;
  second.resolve(page); const coverB=await b;
  expect(earlyDestroy).toBe(0); expect(middleDestroy).toBe(0);
  expect(coverA?.type).toBe('image/jpeg'); expect(coverB?.type).toBe('image/jpeg');
  expect(state.destroy).toHaveBeenCalledOnce();
 });
 it('does not discard the completed cover if detached PDF cleanup rejects',async()=>{
  const pending=deferred(); state.getPage.mockReturnValueOnce(pending.promise);
  state.destroy.mockImplementationOnce(()=>{throw new Error('worker cleanup');});
  const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const request=reader.getCoverBlob({retainOnClose:true});let closeError;
  try { reader.close(); } catch (error) { closeError=error; }
  pending.resolve(page); const cover=await request;expect(closeError).toBeUndefined();
  expect(cover?.type).toBe('image/jpeg');expect(state.destroy).toHaveBeenCalledOnce();
  expect(warning).toHaveBeenCalledWith('No se pudo liberar el PDF de la portada:',expect.any(Error));
 });
});
