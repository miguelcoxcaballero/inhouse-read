import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShelfRefreshQueue } from '../../src/js/shelf-refresh-queue.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('coalesced shelf refresh requests', () => {
  it('turns fifty background notifications into one read after the original eighty millisecond deadline', async () => {
    const perform = vi.fn(() => 'latest'), queue = createShelfRefreshQueue({ perform });
    const requests = Array.from({ length:50 }, () => queue.request());
    await vi.advanceTimersByTimeAsync(79); expect(perform).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await expect(Promise.all(requests)).resolves.toEqual(Array(50).fill('latest'));
    expect(perform).toHaveBeenCalledOnce(); expect(perform).toHaveBeenCalledWith({ immediate:false });
  });
  it('does not restart the background deadline whenever another notification arrives', async () => {
    const perform = vi.fn(), queue = createShelfRefreshQueue({ perform });
    queue.request(); await vi.advanceTimersByTimeAsync(60); queue.request();
    await vi.advanceTimersByTimeAsync(20); expect(perform).toHaveBeenCalledOnce();
  });
  it('immediately flushes an existing background batch and resolves every caller with its result', async () => {
    const perform = vi.fn(() => 7), queue = createShelfRefreshQueue({ perform });
    const background = queue.request(), urgent = queue.request({ immediate:true });
    await tick(); expect(perform).toHaveBeenCalledOnce(); expect(perform).toHaveBeenCalledWith({ immediate:true });
    await expect(background).resolves.toBe(7); await expect(urgent).resolves.toBe(7);
    await vi.advanceTimersByTimeAsync(100); expect(perform).toHaveBeenCalledOnce();
  });
  it('never overlaps reads and collects fifty notifications received in flight into one trailing read', async () => {
    const first = deferred(), second = deferred(); let active = 0, peak = 0;
    const perform = vi.fn(() => { active++; peak = Math.max(peak, active);
      return (perform.mock.calls.length === 1 ? first.promise : second.promise).finally(() => active--); });
    const queue = createShelfRefreshQueue({ perform }), initial = queue.request({ immediate:true });
    await tick(); const trailing = Array.from({ length:50 }, () => queue.request());
    await vi.advanceTimersByTimeAsync(1000); expect(perform).toHaveBeenCalledOnce();
    first.resolve('old'); await tick(); await expect(initial).resolves.toBe('old');
    expect(perform).toHaveBeenCalledTimes(2); expect(peak).toBe(1);
    second.resolve('new'); await expect(Promise.all(trailing)).resolves.toEqual(Array(50).fill('new'));
  });
  it('an immediate request during a read awaits a new trailing snapshot rather than joining the old read', async () => {
    const first = deferred(), second = deferred(), perform = vi.fn()
      .mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const queue = createShelfRefreshQueue({ perform });
    const old = queue.request({ immediate:true }); await tick();
    const background = queue.request(), urgent = queue.request({ immediate:true }); let urgentFinished = false;
    urgent.then(() => { urgentFinished = true; });
    await tick(); expect(perform).toHaveBeenCalledOnce(); expect(urgentFinished).toBe(false);
    first.resolve(1); await tick(); expect(perform).toHaveBeenLastCalledWith({ immediate:true });
    expect(urgentFinished).toBe(false); second.resolve(2);
    await expect(old).resolves.toBe(1); await expect(background).resolves.toBe(2); await expect(urgent).resolves.toBe(2);
    await vi.advanceTimersByTimeAsync(100); expect(perform).toHaveBeenCalledTimes(2);
  });
  it('keeps a not-yet-due trailing batch at its original deadline after a quick read settles', async () => {
    const first = deferred(), perform = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(2);
    const queue = createShelfRefreshQueue({ perform }); queue.request({ immediate:true }); await tick();
    const later = queue.request(); await vi.advanceTimersByTimeAsync(20); first.resolve(1); await tick();
    expect(perform).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(59); expect(perform).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); await expect(later).resolves.toBe(2); expect(perform).toHaveBeenCalledTimes(2);
  });
  it('preserves a read rejection for all callers and still runs a newer pending batch', async () => {
    const first = deferred(), failure = new Error('IDB failed'), perform = vi.fn()
      .mockImplementationOnce(() => first.promise).mockResolvedValue('recovered');
    const queue = createShelfRefreshQueue({ perform }), failed = queue.request({ immediate:true }); await tick();
    const later = queue.request({ immediate:true }); first.reject(failure); await tick();
    await expect(failed).rejects.toBe(failure); await expect(later).resolves.toBe('recovered');
    expect(perform).toHaveBeenCalledTimes(2);
  });
  it('preserves a synchronous perform failure and accepts another request afterward', async () => {
    const failure = new Error('synchronous'), perform = vi.fn().mockImplementationOnce(() => { throw failure; }).mockResolvedValue(3);
    const queue = createShelfRefreshQueue({ perform }); await expect(queue.request({ immediate:true })).rejects.toBe(failure);
    await expect(queue.request({ immediate:true })).resolves.toBe(3);
  });
  it('dispose cancels pending work and future notifications without invoking another read', async () => {
    const perform = vi.fn(), queue = createShelfRefreshQueue({ perform }), waiting = queue.request();
    queue.dispose(); queue.dispose(); await expect(waiting).resolves.toBeUndefined();
    await expect(queue.request({ immediate:true })).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000); expect(perform).not.toHaveBeenCalled();
  });
  it('dispose leaves a running caller intact while cancelling its trailing request', async () => {
    const first = deferred(), perform = vi.fn(() => first.promise), queue = createShelfRefreshQueue({ perform });
    const running = queue.request({ immediate:true }); await tick(); const pending = queue.request({ immediate:true });
    queue.dispose(); await expect(pending).resolves.toBeUndefined(); first.resolve(9);
    await expect(running).resolves.toBe(9); await vi.advanceTimersByTimeAsync(1000); expect(perform).toHaveBeenCalledOnce();
  });
  it('preserves even a falsey rejection reason instead of resolving it', async () => {
    const perform = vi.fn(() => Promise.reject(undefined)), queue = createShelfRefreshQueue({ perform });
    const observed = queue.request({ immediate:true }).then(() => ({ resolved:true }), reason => ({ resolved:false, reason }));
    await expect(observed).resolves.toEqual({ resolved:false, reason:undefined });
  });
  it('dispose before an immediate microtask starts avoids an actual library read', async () => {
    const perform = vi.fn(), queue = createShelfRefreshQueue({ perform }), waiting = queue.request({ immediate:true });
    queue.dispose(); await expect(waiting).resolves.toBeUndefined(); expect(perform).not.toHaveBeenCalled();
  });
});
