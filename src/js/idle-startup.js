/**
 * Start-up work that is not needed to show the shelf waits here: it runs in
 * idle slices once the live shelf has presented a frame (or after a hard
 * deadline), so the first frame never shares the main thread or the network
 * with the offline-shell download, optional chunks or update checks.
 */
import { getRustShelf } from './rust-shelf.js'

// Shared screen ownership for optional shelf/startup work. Park callbacks on
// a signal, never on a polling timer, while the reader owns the screen.
// This module runs before WASM is available. Its small bootstrap never starts a
// download: the already-loading shelf module adopts these same objects lazily.
// Timers/listeners scheduled before adoption keep their identity and ownership.
const state = { active:true, waiters:new Set(), presented:null, presentedDocument:null }
const shelfWaiters = state.waiters
export function setShelfWorkActive(active) {
  const native = getRustShelf()
  if (native) return native.startup_work_active(state, active)
  state.active = Boolean(active)
  if (state.active) for (const resume of [...shelfWaiters]) resume()
}
const allowed = (owner, allowDiscarded = false) => getRustShelf()?.startup_work_allowed(state, owner, allowDiscarded)
  ?? ((allowDiscarded && owner !== globalThis.document) || (state.active && owner?.visibilityState !== 'hidden'))

/** A cooperative safe point for CPU work already in progress. */
export function shelfWorkReady() {
  const owner = globalThis.document
  if (allowed(owner)) return Promise.resolve()
  return new Promise(resolve => {
    const resume = () => {
      if (!allowed(owner, true)) return
      shelfWaiters.delete(resume)
      owner?.removeEventListener('visibilitychange', resume)
      resolve()
    }
    shelfWaiters.add(resume)
    owner?.addEventListener('visibilitychange', resume)
  })
}

/** Resolves once the shelf canvas has drawn, or after the deadline (e.g. no WebGL). */
export function shelfPresented() {
  const ownerDocument = globalThis.document
  const native = getRustShelf()
  const cached = native ? native.startup_presented_cached(state, ownerDocument) : (() => {
    if (!ownerDocument) return false
    if (state.presentedDocument !== ownerDocument) { state.presented = null; state.presentedDocument = ownerDocument }
    return state.presented
  })()
  if (cached === false) return Promise.resolve(false)
  if (cached) return cached
  return state.presented = new Promise(resolve => {
    const started = performance.now()
    const check = () => {
      // A discarded document cannot present a frame or own startup tasks.
      const result = getRustShelf()?.startup_presented_check(ownerDocument, started) ?? (() => {
        if (globalThis.document !== ownerDocument) return -1
        const canvas = ownerDocument.querySelector('canvas.ihr-bookshelf-scene')
        return Number(canvas?.dataset.renderCount) > 0 || performance.now() - started > 8000 ? 1 : 0
      })()
      if (result) return resolve(result > 0)
      setTimeout(check, 100)
    }
    check()
  })
}

export function idleWork(callback, { timeout = 2000, fallbackMs = 50 } = {}) {
  const owner = globalThis.document
  const schedule = () => {
    if (!allowed(owner)) {
      shelfWaiters.add(resume)
      owner?.addEventListener('visibilitychange', resume)
      return
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(complete, { timeout })
    else setTimeout(() => complete({ timeRemaining:() => 0 }), fallbackMs)
  }
  const resume = () => {
    if (!allowed(owner)) return
    shelfWaiters.delete(resume)
    owner?.removeEventListener('visibilitychange', resume)
    schedule()
  }
  // A queued slice may race with locking the phone. Park on one event
  // listener instead of repeatedly waking background timers.
  const complete = deadline => {
    if (!allowed(owner, true)) schedule()
    else callback(deadline)
  }
  schedule()
}

export function idleSlice(options) {
  return new Promise(resolve => idleWork(resolve, options))
}

/** Runs the tasks one per idle slice after the first live frame; a failing task never stops the rest. */
export async function runAfterFirstFrame(tasks) {
  const ownerDocument = globalThis.document
  const presented = shelfPresented()
  // Await the first frame in the host: it may still be waiting for the shelf
  // module itself. Once presented, native policy owns the full task sequence.
  if (!await presented) return
  const native = getRustShelf()
  if (native) return native.startup_run_tasks(ownerDocument, true, tasks, idleSlice)
  for (const task of tasks) {
    await idleSlice()
    if (globalThis.document !== ownerDocument) return
    try { await task() } catch (error) { console.warn('Carga diferida omitida:', error) }
  }
}
