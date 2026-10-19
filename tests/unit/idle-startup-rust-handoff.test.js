import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
const native = needRustShelf();
let ready, startup;
const flush = async () => { for (let n=0; n<12; n++) await Promise.resolve(); };
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); ready=false;
  vi.stubGlobal('requestIdleCallback', undefined);
  vi.doMock('../../src/js/rust-shelf.js', () => ({ getRustShelf:() => ready ? native : null }));
  document.body.innerHTML='';
  startup=await import('../../src/js/idle-startup.js');
});
afterEach(() => {
  vi.doUnmock('../../src/js/rust-shelf.js'); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  document.body.innerHTML='';
});

it('adopts the pending first-frame promise and timer without restarting either', async () => {
  const pending=startup.shelfPresented();
  await vi.advanceTimersByTimeAsync(7900); ready=true;
  expect(startup.shelfPresented()).toBe(pending); expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(200);
  expect(await pending).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('adopts parked CPU and idle work without waking the reader or polling', async () => {
  startup.setShelfWorkActive(false);
  const task=vi.fn(), cpu=vi.fn();
  startup.idleWork(task); const pending=startup.shelfWorkReady().then(cpu);
  ready=true; await vi.advanceTimersByTimeAsync(60_000);
  expect(vi.getTimerCount()).toBe(0); expect(task).not.toHaveBeenCalled(); expect(cpu).not.toHaveBeenCalled();
  startup.setShelfWorkActive(true); await vi.advanceTimersByTimeAsync(50); await pending;
  expect(task).toHaveBeenCalledOnce(); expect(cpu).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('rechecks reader ownership on an idle slice queued before adoption', async () => {
  const task=vi.fn(); startup.idleWork(task); ready=true; startup.setShelfWorkActive(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  startup.setShelfWorkActive(true); await vi.advanceTimersByTimeAsync(50);
  expect(task).toHaveBeenCalledOnce();
});

it('starts native task sequencing after the first frame even when boot began before WASM', async () => {
  const first=vi.fn(), second=vi.fn();
  const pending=startup.runAfterFirstFrame([first, second]);
  ready=true; document.body.innerHTML='<canvas class="ihr-bookshelf-scene" data-render-count="1"></canvas>';
  await vi.advanceTimersByTimeAsync(150); expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(50); await pending; expect(second).toHaveBeenCalledOnce();
});

it('closes a task generator when its document disappears during the idle wait', async () => {
  ready=true; document.body.innerHTML='<canvas class="ihr-bookshelf-scene" data-render-count="1"></canvas>';
  const task=vi.fn(), close=vi.fn();
  function* tasks() { try { yield task; yield task; } finally { close(); } }
  const pending=startup.runAfterFirstFrame(tasks()); await flush();
  vi.stubGlobal('document', undefined); await vi.advanceTimersByTimeAsync(50); await pending;
  expect(close).toHaveBeenCalledOnce(); expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('takes an ownership waiter snapshot and tolerates reentrant ownership changes', async () => {
  ready=true;
  const order=[], state={active:false, waiters:new Set()};
  const second=() => order.push('second');
  state.waiters.add(() => { order.push('first'); state.waiters.delete(second); native.startup_work_active(state, false); });
  state.waiters.add(second);
  native.startup_work_active(state, true);
  expect(order).toEqual(['first','second']); expect(state.active).toBe(false);
});

it('preserves iterator receiver identity, reads return once and accepts callable iterator objects', async () => {
  ready=true;
  let reads=0;
  const task=vi.fn(), iterator=function () {};
  iterator.next=() => Object.assign(function () {}, {done:false, value:task});
  Object.defineProperty(iterator, 'return', {get() {
    reads++; return function () { expect(this).toBe(iterator); return function () {}; };
  }});
  const pending=native.startup_run_tasks(document, true, {[Symbol.iterator]:() => iterator}, async () => {
    vi.stubGlobal('document', undefined);
  });
  await pending;
  expect(reads).toBe(1); expect(task).not.toHaveBeenCalled();
});

it('releases native handles after successful work, rejected tasks and failing host conversions', async () => {
  ready=true; const warning=vi.spyOn(console,'warn').mockImplementation(() => {});
  const owner=document, before=native.shelf_live_handles();
  for (let n=0; n<30; n++) {
    const badPromise=Promise.resolve(); Object.defineProperty(badPromise, 'constructor', {get(){throw Error('constructor');}});
    await native.startup_run_tasks(owner, true, [() => 1, () => Promise.reject(Error('offline')), () => badPromise], () => Promise.resolve());
    const query=vi.spyOn(owner,'querySelector').mockReturnValue({dataset:{renderCount:{valueOf(){throw Error('conversion');}}}});
    expect(() => native.startup_presented_check(owner, 0)).toThrow('conversion'); query.mockRestore();
  }
  await flush();
  expect(warning).toHaveBeenCalledTimes(60); expect(native.shelf_live_handles()).toBe(before);
});

it('does not import heavy modules, start fetches or await WASM during bootstrap', async () => {
  const fetch=vi.fn(); vi.stubGlobal('fetch', fetch);
  startup.setShelfWorkActive(false); startup.idleWork(vi.fn());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
