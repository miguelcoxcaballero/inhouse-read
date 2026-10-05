import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let startup;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  document.body.innerHTML='';
  startup=await import('../../src/js/idle-startup.js');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML=''; });
const frame = () => { document.body.innerHTML='<canvas class="ihr-bookshelf-scene" data-render-count="1"></canvas>'; };

describe('startup tasks belong to their document', () => {
  it('starts immediately after an actual shelf frame', async () => {
    frame(); expect(await startup.shelfPresented()).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for the shelf frame and shares one poll among callers', async () => {
    const first=startup.shelfPresented(), second=startup.shelfPresented();
    expect(first).toBe(second); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100); frame(); await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains the original eight-second fallback when WebGL is unavailable', async () => {
    const pending=startup.shelfPresented(); await vi.advanceTimersByTimeAsync(8100);
    expect(await pending).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('ends polling without an exception if its document is discarded', async () => {
    const pending=startup.shelfPresented(); vi.stubGlobal('document',undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start optional work after a discarded context', async () => {
    const task=vi.fn(), pending=startup.runAfterFirstFrame([task]); vi.stubGlobal('document',undefined);
    await vi.advanceTimersByTimeAsync(200);
    await pending; expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('checks ownership again after the idle wait', async () => {
    frame(); const task=vi.fn(), pending=startup.runAfterFirstFrame([task]); await Promise.resolve();
    vi.stubGlobal('document',undefined); await vi.advanceTimersByTimeAsync(50);
    await pending; expect(task).not.toHaveBeenCalled();
  });
  it('runs one task per idle slice and continues after an optional failure', async () => {
    frame(); const order=[], warning=vi.spyOn(console,'warn').mockImplementation(() => {});
    const pending=startup.runAfterFirstFrame([() => {order.push(1);throw Error('Unavailable');}, () => order.push(2)]);
    await vi.advanceTimersByTimeAsync(50); expect(order).toEqual([1]);
    await vi.advanceTimersByTimeAsync(50); await pending; expect(order).toEqual([1,2]); expect(warning).toHaveBeenCalledOnce();
  });
});
