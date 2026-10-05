import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSnapshotPaperTones, readPaperTone } from '../../src/js/page-paper-tone.js';
import { samplePaperTone } from '../../src/js/page-paper-tone-sample.js';

const pixels = (rgb, alpha = 255) => new Uint8ClampedArray(Array.from({ length:144 }, () => [...rgb, alpha]).flat());
let worker, bitmaps, mode, reply;
beforeEach(() => {
  worker = null; bitmaps = []; mode = 'success'; reply = [[237, 225, 201], [255, 255, 255]];
  vi.stubGlobal('OffscreenCanvas', function () {});
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    const bitmap = { close:vi.fn() }; bitmaps.push(bitmap); return bitmap;
  }));
  vi.stubGlobal('Worker', class {
    constructor(url, options) {
      if (mode === 'constructor') throw Error('Blocked');
      Object.assign(this, { url, options, terminate:vi.fn() }); worker = this;
    }
    postMessage(data, transfer) {
      Object.assign(this, { data, transfer });
      if (mode === 'post') throw Error('Transfer failed');
      if (mode === 'pending') return;
      queueMicrotask(() => mode === 'error' || mode === 'messageerror'
        ? this[mode === 'error' ? 'onerror' : 'onmessageerror']?.({ preventDefault:vi.fn() })
        : this.onmessage?.({ data:{ tones:reply } }));
    }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const snapshot = () => ({ source:{}, toneKey:Object.freeze({}), paper:{ source:{}, toneKey:Object.freeze({}) } });

describe('exact paper-margin rule', () => {
  it('keeps the exact median of the 44 outer-ring pixels, ignoring the interior', () => {
    const data = pixels([237, 225, 201]);
    for (let y=1; y<11; y++) for (let x=1; x<11; x++) data.fill(0, (y*12+x)*4, (y*12+x)*4+4);
    expect(samplePaperTone(data)).toEqual([237,225,201]);
  });
  it('keeps the original alpha threshold and minimum opaque margin', () => {
    expect(samplePaperTone(pixels([255,255,255],200))).toBeNull();
    expect(samplePaperTone(pixels([255,255,255],201))).toEqual([255,255,255]);
  });
  it('retains null for a varied full-bleed margin', () => {
    const data = pixels([255,255,255]);
    for (let x=0; x<12; x++) data.fill(0, x*4, x*4+3);
    for (let y=0; y<12; y++) data.fill(0, y*12*4, y*12*4+3);
    expect(samplePaperTone(data)).toBeNull();
  });
});

describe('asynchronous paper sampling', () => {
  it('transfers both exact page copies and makes both tones available without UI readback', async () => {
    const page = snapshot(), create = vi.spyOn(document,'createElement');
    expect(await prepareSnapshotPaperTones(page)).toBe(true);
    expect(worker.url.pathname).toContain('/page-paper-tone-worker.js'); expect(worker.options).toEqual({type:'module'});
    expect(worker.transfer).toEqual(bitmaps); expect(worker.data).toEqual({bitmaps});
    expect(readPaperTone(page.source,page.toneKey)).toEqual(reply[0]);
    expect(readPaperTone(page.paper.source,page.paper.toneKey)).toEqual(reply[1]);
    expect(create).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce();
    bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce());
    expect([worker.onmessage,worker.onerror,worker.onmessageerror]).toEqual([null,null,null]);
  });
  it('reuses measurements for new copies of an unchanged raster without another bitmap or worker', async () => {
    const page = snapshot(); await prepareSnapshotPaperTones(page);
    expect(await prepareSnapshotPaperTones({...page,source:{},paper:{...page.paper,source:{}}})).toBe(true);
    expect(createImageBitmap).toHaveBeenCalledTimes(2); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('shares one job between overlapping captures of the same tokens', async () => {
    mode='pending'; const page=snapshot(), first=prepareSnapshotPaperTones(page), second=prepareSnapshotPaperTones(page);
    await vi.waitFor(() => expect(worker).not.toBeNull()); worker.onmessage({data:{tones:reply}});
    expect(await first).toBe(true); expect(await second).toBe(true); expect(createImageBitmap).toHaveBeenCalledTimes(2);
  });
  it('caches null decisions without another attempt', async () => {
    reply=[null,null]; const page=snapshot(); expect(await prepareSnapshotPaperTones(page)).toBe(true);
    expect(readPaperTone(page.source,page.toneKey)).toBeNull(); expect(await prepareSnapshotPaperTones(page)).toBe(true);
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
  });
  it.each(['Worker','OffscreenCanvas','createImageBitmap'])('preserves the original sampler when %s is unavailable', async name => {
    vi.stubGlobal(name,undefined); expect(await prepareSnapshotPaperTones(snapshot())).toBe(false); expect(worker).toBeNull();
  });
  it.each(['constructor','post','error','messageerror'])('releases resources after %s failure and leaves the token unmeasured', async failure => {
    mode=failure; const page=snapshot(); expect(await prepareSnapshotPaperTones(page)).toBe(false);
    bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce());
    if(worker) expect(worker.terminate).toHaveBeenCalledOnce();
    const context={drawImage:vi.fn(),getImageData:vi.fn(() => ({data:pixels([7,8,9])}))};
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
    expect(readPaperTone(page.source,page.toneKey)).toEqual([7,8,9]); expect(context.getImageData).toHaveBeenCalledOnce();
  });
  it.each([[], [[1,2]], [[-1,0,0],null], [[1.5,0,0],null], [[256,0,0],null], ['bad',null]])('rejects malformed tones %j without caching guesses', async tones => {
    reply=tones; expect(await prepareSnapshotPaperTones(snapshot())).toBe(false); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('releases already-created bitmaps if preparing the second page fails', async () => {
    const first={close:vi.fn()};
    vi.mocked(createImageBitmap).mockResolvedValueOnce(first).mockRejectedValueOnce(Error('No pixels'));
    expect(await prepareSnapshotPaperTones(snapshot())).toBe(false); expect(worker).toBeNull();
    expect(first.close).toHaveBeenCalledOnce(); expect(createImageBitmap).toHaveBeenCalledTimes(2);
  });
  it('does no work when already cancelled', async () => {
    const controller=new AbortController(); controller.abort();
    expect(await prepareSnapshotPaperTones(snapshot(),{signal:controller.signal})).toBe(false);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it('terminates a cancelled worker and ignores its late reply', async () => {
    mode='pending'; const controller=new AbortController(), page=snapshot();
    const job=prepareSnapshotPaperTones(page,{signal:controller.signal}); await vi.waitFor(() => expect(worker).not.toBeNull());
    const late=worker.onmessage; controller.abort(); expect(await job).toBe(false); late({data:{tones:reply}});
    expect(worker.terminate).toHaveBeenCalledOnce(); bitmaps.forEach(bitmap => expect(bitmap.close).toHaveBeenCalledOnce());
    const context={drawImage:vi.fn(),getImageData:vi.fn(() => ({data:pixels([10,11,12])}))};
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
    expect(readPaperTone(page.source,page.toneKey)).toEqual([10,11,12]);
  });
});

describe('actual paper worker entry point', () => {
  it('samples each bitmap with identical interpolation and releases its offscreen buffer', async () => {
    const context={clearRect:vi.fn(),drawImage:vi.fn(),getImageData:vi.fn(() => ({data:pixels([236,221,199])}))};
    const canvas={width:12,height:12,getContext:vi.fn(() => context)}, target={postMessage:vi.fn()};
    vi.stubGlobal('OffscreenCanvas',vi.fn(function(){return canvas;})); vi.stubGlobal('self',target);
    await import('../../src/js/page-paper-tone-worker.js');
    const images=[{close:vi.fn()},{close:vi.fn()}]; target.onmessage({data:{bitmaps:images}});
    expect(OffscreenCanvas).toHaveBeenCalledExactlyOnceWith(12,12);
    expect(canvas.getContext).toHaveBeenCalledExactlyOnceWith('2d',{willReadFrequently:true});
    images.forEach(image => { expect(context.drawImage).toHaveBeenCalledWith(image,0,0,12,12); expect(image.close).toHaveBeenCalledOnce(); });
    expect(target.postMessage).toHaveBeenCalledExactlyOnceWith({tones:[[236,221,199],[236,221,199]]});
    expect([canvas.width,canvas.height]).toEqual([0,0]);
  });
});
