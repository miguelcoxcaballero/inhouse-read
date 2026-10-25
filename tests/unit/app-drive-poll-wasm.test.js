import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import { rustUI } from './helpers/rust-ui-ready.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
function fixture(native = rustShelf) {
  const state = { appDisposed:false, drivePollTimer:null, drivePollGeneration:0 }
  const callbacks = []
  const host = { state, document:{ hidden:false }, libraryBackup:{ task:null },
    online:vi.fn(()=>true), hasDriveSession:vi.fn(()=>true), getRememberedDriveProfile:vi.fn(()=>null),
    pollDrive:vi.fn(), cancelDrivePoll:vi.fn(timer=>clearTimeout(timer)),
    armDrivePoll:vi.fn((generation, delay)=>{
      const callback=()=>native.app_drive_poll_tick(host,generation)
      callbacks.push(callback)
      return setTimeout(callback,delay)
    })
  }
  return { native, host, state, callbacks, update:()=>native.app_drive_poll_update(host) }
}

it.each([['shelf',rustShelf],['UI',rustUI]])('keeps one five-second timer for an active account through %s', (_name,module) => {
  const f=fixture(module)
  f.update();f.update();f.update()
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(4999);expect(f.host.pollDrive).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1);expect(f.host.pollDrive).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(5000);expect(f.host.pollDrive).toHaveBeenCalledTimes(2)
})

it.each(['no account','hidden','offline','disposed'])('stops and rejects stale queued callbacks when %s', reason => {
  const f=fixture();f.update();const stale=f.callbacks[0]
  if(reason==='no account')f.host.hasDriveSession.mockReturnValue(false)
  if(reason==='hidden')f.host.document.hidden=true
  if(reason==='offline')f.host.online.mockReturnValue(false)
  if(reason==='disposed')f.state.appDisposed=true
  f.update();expect(vi.getTimerCount()).toBe(0);expect(f.state.drivePollTimer).toBeNull()
  stale();expect(f.host.pollDrive).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
  f.host.hasDriveSession.mockReturnValue(true);f.host.document.hidden=false;f.host.online.mockReturnValue(true);f.state.appDisposed=false
  f.update();const current=f.state.drivePollTimer
  stale();expect(f.state.drivePollTimer).toBe(current);expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(5000);expect(f.host.pollDrive).toHaveBeenCalledOnce()
})

it('never creates a timer without an account, and retries remembered sessions', () => {
  const f=fixture();f.host.hasDriveSession.mockReturnValue(false)
  f.update();expect(vi.getTimerCount()).toBe(0);expect(f.host.armDrivePoll).not.toHaveBeenCalled()
  f.host.getRememberedDriveProfile.mockReturnValue({id:'saved'})
  f.update();expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(5000);expect(f.host.pollDrive).toHaveBeenCalledOnce()
  f.host.getRememberedDriveProfile.mockReturnValue(null);f.update();expect(vi.getTimerCount()).toBe(0)
})

it('retains cadence while a backup owns the network and recovers when it finishes', () => {
  const f=fixture();f.host.libraryBackup.task=Promise.resolve()
  f.update();vi.advanceTimersByTime(10000)
  expect(f.host.pollDrive).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(1)
  f.host.libraryBackup.task=null;vi.advanceTimersByTime(5000)
  expect(f.host.pollDrive).toHaveBeenCalledOnce()
})

it('rearms after a synchronous error without letting an old callback replace the new timer', () => {
  const f=fixture();f.update();const first=f.callbacks[0]
  f.host.pollDrive.mockImplementationOnce(()=>{throw Error('temporary')})
  clearTimeout(f.state.drivePollTimer)
  expect(first).toThrow('temporary');expect(vi.getTimerCount()).toBe(1)
  const timer=f.state.drivePollTimer
  first();expect(f.state.drivePollTimer).toBe(timer);expect(f.host.pollDrive).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(5000);expect(f.host.pollDrive).toHaveBeenCalledTimes(2)
})
