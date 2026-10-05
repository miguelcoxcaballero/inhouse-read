import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePdfCover } from '../../src/js/readers/cover-encode.js';

let bitmap, canvas, worker, blob, behavior;
beforeEach(() => {
  blob=new Blob(['exact jpeg'],{type:'image/jpeg'});
  bitmap={width:1200,height:1600,close:vi.fn()};
  canvas={width:1200,height:1600,toBlob:vi.fn(callback=>callback(blob))};
  behavior='success';worker=null;
  vi.stubGlobal('OffscreenCanvas',function OffscreenCanvas() {});
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  vi.stubGlobal('Worker',class {
    constructor(url,options) {
      if(behavior==='constructor-error')throw Error('Blocked worker');
      this.url=url;this.options=options;this.terminate=vi.fn();worker=this;
    }
    postMessage(message,transfer) {
      this.message=message;this.transfer=transfer;
      if(behavior==='post-error')throw Error('Unsupported transfer');
      if(behavior==='pending')return;
      queueMicrotask(()=>{
        if(behavior==='error'||behavior==='message-error')this[behavior==='error'?'onerror':'onmessageerror']?.({preventDefault:vi.fn()});
        else this.onmessage?.({data:behavior==='invalid-reply'?{unavailable:true}: {blob}});
      });
    }
  });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('PDF JPEG encoding outside the UI thread',()=>{
  it('transfers the full raster to an owned module worker and releases both resources',async()=>{
    expect(await encodePdfCover(canvas)).toBe(blob);
    expect(createImageBitmap).toHaveBeenCalledExactlyOnceWith(canvas);
    expect(worker.url.pathname).toContain('/cover-encode-worker.js');expect(worker.options).toEqual({type:'module'});
    expect(worker.message).toEqual({bitmap});expect(worker.transfer).toEqual([bitmap]);
    expect(canvas.toBlob).not.toHaveBeenCalled();expect(worker.terminate).toHaveBeenCalledOnce();expect(bitmap.close).toHaveBeenCalledOnce();
    expect([worker.onmessage,worker.onerror,worker.onmessageerror]).toEqual([null,null,null]);
  });
  it.each(['Worker','OffscreenCanvas','createImageBitmap'])('retains the original .9 JPEG encoder when %s is unavailable',async name=>{
    vi.stubGlobal(name,undefined);expect(await encodePdfCover(canvas)).toBe(blob);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function),'image/jpeg',.9);expect(worker).toBeNull();
  });
  it.each(['constructor-error','post-error','error','message-error','invalid-reply'])('falls back exactly once after %s and closes the bitmap',async mode=>{
    behavior=mode;expect(await encodePdfCover(canvas)).toBe(blob);
    expect(canvas.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function),'image/jpeg',.9);
    expect(bitmap.close).toHaveBeenCalledOnce();if(worker)expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('falls back after bitmap preparation fails without leaking a worker',async()=>{
    vi.mocked(createImageBitmap).mockRejectedValueOnce(Error('Cannot snapshot'));
    expect(await encodePdfCover(canvas)).toBe(blob);expect(worker).toBeNull();expect(bitmap.close).not.toHaveBeenCalled();
    expect(canvas.toBlob).toHaveBeenCalledOnce();
  });
  it('does no work for an already cancelled cover',async()=>{
    const controller=new AbortController();controller.abort();expect(await encodePdfCover(canvas,{signal:controller.signal})).toBeNull();
    expect(createImageBitmap).not.toHaveBeenCalled();expect(canvas.toBlob).not.toHaveBeenCalled();expect(worker).toBeNull();
  });
  it('closes a prepared bitmap if cancelled before it can transfer',async()=>{
    let ready;vi.mocked(createImageBitmap).mockImplementation(()=>new Promise(resolve=>ready=resolve));
    const controller=new AbortController(),pending=encodePdfCover(canvas,{signal:controller.signal});controller.abort();ready(bitmap);
    expect(await pending).toBeNull();expect(worker).toBeNull();expect(bitmap.close).toHaveBeenCalledOnce();expect(canvas.toBlob).not.toHaveBeenCalled();
  });
  it('cancels an active worker without starting a second encoder or accepting a late reply',async()=>{
    behavior='pending';const controller=new AbortController(),pending=encodePdfCover(canvas,{signal:controller.signal});await Promise.resolve();
    const reply=worker.onmessage;controller.abort();expect(await pending).toBeNull();reply({data:{blob}});
    expect(worker.terminate).toHaveBeenCalledOnce();expect(bitmap.close).toHaveBeenCalledOnce();expect(canvas.toBlob).not.toHaveBeenCalled();
  });
  it('keeps independent ownership for concurrent cover captures',async()=>{
    const first=encodePdfCover(canvas),second=encodePdfCover(canvas);expect(await first).toBe(blob);expect(await second).toBe(blob);
    expect(createImageBitmap).toHaveBeenCalledTimes(2);expect(canvas.toBlob).not.toHaveBeenCalled();expect(bitmap.close).toHaveBeenCalledTimes(2);
  });
});

describe('actual worker protocol',()=>{
  async function install(failure) {
    vi.resetModules();const context={drawImage:vi.fn()},offscreen={width:1200,height:1600,getContext:vi.fn(()=>failure==='context'?null:context),
      convertToBlob:vi.fn(async()=>{if(failure==='encode')throw Error('Encoding failed');return blob;})};
    vi.stubGlobal('OffscreenCanvas',vi.fn(function(){return offscreen;}));
    const target={postMessage:vi.fn()};vi.stubGlobal('self',target);await import('../../src/js/readers/cover-encode-worker.js');
    return {target,context,offscreen};
  }
  it('draws the actual bitmap 1:1 and encodes JPEG at the existing quality',async()=>{
    const {target,context,offscreen}=await install();await target.onmessage({data:{bitmap}});
    expect(OffscreenCanvas).toHaveBeenCalledExactlyOnceWith(1200,1600);expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap,0,0);
    expect(offscreen.convertToBlob).toHaveBeenCalledExactlyOnceWith({type:'image/jpeg',quality:.9});expect(target.postMessage).toHaveBeenCalledExactlyOnceWith({blob});
    expect(bitmap.close).toHaveBeenCalledOnce();expect([offscreen.width,offscreen.height]).toEqual([0,0]);
  });
  it.each(['context','encode'])('reports %s failure and releases the complete raster',async failure=>{
    const {target,offscreen}=await install(failure);await target.onmessage({data:{bitmap}});
    expect(target.postMessage).toHaveBeenCalledExactlyOnceWith({unavailable:true});expect(bitmap.close).toHaveBeenCalledOnce();
    expect([offscreen.width,offscreen.height]).toEqual([0,0]);
  });
});
