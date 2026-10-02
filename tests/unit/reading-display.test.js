import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initReadingDisplay } from '../../src/js/reading-display.js'

let policy, request, native, visibility, locks
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const sentinel = () => {
  const lock = new EventTarget()
  lock.release = vi.fn(async () => { lock.dispatchEvent(new Event('release')) })
  locks.push(lock)
  return lock
}
const classes = async value => { document.body.className = value; await settle() }
const hide = async value => { visibility = value ? 'hidden' : 'visible'; document.dispatchEvent(new Event('visibilitychange')); await settle() }

beforeEach(() => {
  document.body.className = ''; locks = []; visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  request = vi.fn(async () => sentinel())
  native = vi.fn()
  window.InhouseNative = { setReadingMode:native }
})
afterEach(async () => {
  policy?.dispose(); policy = null; await settle()
  delete window.InhouseNative; document.body.className = ''
  vi.restoreAllMocks()
})
const start = () => { policy = initReadingDisplay({ navigator:{ wakeLock:{ request } } }) }

describe('reader display ownership', () => {
  it('leaves the shelf and selected cover alone, then holds the screen only while reading', async () => {
    start(); await settle()
    expect(native.mock.calls).toEqual([[false]])
    expect(request).not.toHaveBeenCalled()
    await classes('is-reading')
    expect(native.mock.calls).toEqual([[false], [true]])
    expect(request).toHaveBeenCalledExactlyOnceWith('screen')
    await classes('')
    expect(native).toHaveBeenLastCalledWith(false)
    expect(locks[0].release).toHaveBeenCalledTimes(1)
  })

  it('does not resize the native viewport during opening or returning flights', async () => {
    start()
    await classes('is-reading is-opening-reader')
    expect(native.mock.calls).toEqual([[false]])
    expect(request).not.toHaveBeenCalled()
    await classes('is-reading')
    expect(native).toHaveBeenLastCalledWith(true)
    await classes('is-reading is-closing-reader')
    await classes('is-closing-reader')
    expect(native.mock.calls).toEqual([[false], [true]])
    expect(locks[0].release).not.toHaveBeenCalled()
    await classes('')
    expect(native).toHaveBeenLastCalledWith(false)
    expect(locks[0].release).toHaveBeenCalledTimes(1)
  })

  it('never enters reading policy when an opening is cancelled', async () => {
    start()
    await classes('is-reading is-opening-reader')
    await classes('')
    expect(native.mock.calls).toEqual([[false]])
    expect(request).not.toHaveBeenCalled()
  })

  it('releases in the background and reacquires when the same reader becomes visible', async () => {
    start(); await classes('is-reading')
    await hide(true)
    expect(locks[0].release).toHaveBeenCalledTimes(1)
    expect(native).toHaveBeenLastCalledWith(false)
    await hide(false)
    expect(request).toHaveBeenCalledTimes(2)
    expect(native).toHaveBeenLastCalledWith(true)
  })

  it('releases a pending result when closing, even if it arrives after another book opens', async () => {
    let finish
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    start(); await classes('is-reading')
    await classes(''); await classes('is-reading')
    const stale = sentinel(); finish(stale); await settle()
    expect(stale.release).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
    expect(locks[1].release).not.toHaveBeenCalled()
  })

  it('handles denied requests without a retry loop and retries on a later interaction', async () => {
    request.mockRejectedValueOnce(new Error('Battery saver'))
    start(); await classes('is-reading'); await settle()
    expect(request).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('pointerdown')); await settle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('handles platform release and a subsequent focus without duplicating live locks', async () => {
    start(); await classes('is-reading')
    window.dispatchEvent(new Event('focus')); await settle()
    expect(request).toHaveBeenCalledTimes(1)
    locks[0].dispatchEvent(new Event('release'))
    window.dispatchEvent(new Event('focus')); await settle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('restores the native bars on pagehide and reacquires on a BFCache pageshow', async () => {
    start(); await classes('is-reading')
    window.dispatchEvent(new Event('pagehide')); await settle()
    expect(native).toHaveBeenLastCalledWith(false)
    expect(locks[0].release).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('pageshow')); await settle()
    expect(native).toHaveBeenLastCalledWith(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('disposes pending work, observers and listeners without reacquiring', async () => {
    let finish
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    start(); await classes('is-reading')
    policy.dispose(); policy.dispose()
    const stale = sentinel(); finish(stale); await settle()
    expect(stale.release).toHaveBeenCalledTimes(1)
    expect(native).toHaveBeenLastCalledWith(false)
    window.dispatchEvent(new Event('focus')); await classes('is-reading')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('works in the browser without a native bridge and in shells without Wake Lock', async () => {
    delete window.InhouseNative
    start(); await classes('is-reading')
    expect(request).toHaveBeenCalledTimes(1)
    policy.dispose()
    policy = initReadingDisplay({ navigator:{} })
    await classes(''); await classes('is-reading')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
