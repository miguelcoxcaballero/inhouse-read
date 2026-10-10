import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareSnapshotPaperTones, readPaperTone, sharePaperTone } from '../../src/js/page-paper-tone.js';
let workers, bitmaps, tones;
beforeEach(() => {
  workers=[]; bitmaps=[]; tones=[[255,255,255]];
  vi.stubGlobal('OffscreenCanvas',function(){});
  vi.stubGlobal('createImageBitmap',vi.fn(async () => {
    const bitmap={close:vi.fn()}; bitmaps.push(bitmap); return bitmap;
  }));
  vi.stubGlobal('Worker',class {
    constructor(){this.terminate=vi.fn();workers.push(this);}
    postMessage(data,transfer){this.data=data;this.transfer=transfer;queueMicrotask(() => this.onmessage?.({data:{tones}}));}
  });
});
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();});
const snapshot=()=>({source:{},toneKey:{},paper:{source:{},toneKey:{}}});
describe('one measurement of reader-proven equal pixels',()=>{
  it('keeps distinct public tokens and copies while transferring only one bitmap',async()=>{
    const page=snapshot(); expect(sharePaperTone(page.paper.toneKey,page.toneKey)).toBe(true);
    expect(page.paper.toneKey).not.toBe(page.toneKey);expect(page.paper.source).not.toBe(page.source);
    expect(await prepareSnapshotPaperTones(page)).toBe(true);
    expect(createImageBitmap).toHaveBeenCalledOnce();expect(workers[0].transfer).toEqual(bitmaps);
    const create=vi.spyOn(document,'createElement');
    expect(readPaperTone(page.source,page.toneKey)).toEqual([255,255,255]);
    expect(readPaperTone(page.paper.source,page.paper.toneKey)).toEqual([255,255,255]);
    expect(create).not.toHaveBeenCalled();expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('retains two separate samples when a theme or filter changes the pixels',async()=>{
    const page=snapshot();tones=[[235,224,198],[255,255,255]];
    expect(await prepareSnapshotPaperTones(page)).toBe(true);expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(readPaperTone(page.source,page.toneKey)).toEqual(tones[0]);
    expect(readPaperTone(page.paper.source,page.paper.toneKey)).toEqual(tones[1]);
  });
  it('reuses the one measurement for fresh copies of the same settled raster',async()=>{
    const page=snapshot();sharePaperTone(page.paper.toneKey,page.toneKey);
    await prepareSnapshotPaperTones(page);
    expect(await prepareSnapshotPaperTones({...page,source:{},paper:{...page.paper,source:{}}})).toBe(true);
    expect(createImageBitmap).toHaveBeenCalledOnce();expect(workers).toHaveLength(1);
  });
  it('caches a full-bleed null decision for both equal copies',async()=>{
    const page=snapshot();tones=[null];sharePaperTone(page.paper.toneKey,page.toneKey);
    expect(await prepareSnapshotPaperTones(page)).toBe(true);
    expect(readPaperTone(page.source,page.toneKey)).toBeNull();expect(readPaperTone(page.paper.source,page.paper.toneKey)).toBeNull();
    expect(await prepareSnapshotPaperTones(page)).toBe(true);expect(createImageBitmap).toHaveBeenCalledOnce();
  });
  it('uses a fresh measurement for a later page or changed raster',async()=>{
    const first=snapshot(),next=snapshot();sharePaperTone(first.paper.toneKey,first.toneKey);
    await prepareSnapshotPaperTones(first);sharePaperTone(next.paper.toneKey,next.toneKey);
    tones=[[237,228,207]];await prepareSnapshotPaperTones(next);
    expect(createImageBitmap).toHaveBeenCalledTimes(2);expect(readPaperTone(next.paper.source,next.paper.toneKey)).toEqual(tones[0]);
    expect(readPaperTone(first.paper.source,first.paper.toneKey)).toEqual([255,255,255]);
  });
  it('does not silently rebind a proved identity or make a cycle',()=>{
    const first={},second={},third={};expect(sharePaperTone(second,first)).toBe(true);
    expect(sharePaperTone(second,first)).toBe(true);expect(sharePaperTone(second,third)).toBe(false);
    expect(sharePaperTone(first,second)).toBe(false);
  });
  it('preserves an already measured target instead of overriding it',async()=>{
    const page=snapshot();tones=[[235,224,198],[255,255,255]];await prepareSnapshotPaperTones(page);
    expect(sharePaperTone(page.paper.toneKey,page.toneKey)).toBe(false);
    expect(readPaperTone(page.paper.source,page.paper.toneKey)).toEqual([255,255,255]);
  });
  it.each([null,undefined,'colour',17])('rejects a non-object identity %s',value=>{
    expect(sharePaperTone(value,{})).toBe(false);expect(sharePaperTone({},value)).toBe(false);
  });
});
