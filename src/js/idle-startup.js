/**
 * Start-up work that is not needed to show the shelf waits here: it runs in
 * idle slices once the live shelf has presented a frame (or after a hard
 * deadline), so the first frame never shares the main thread or the network
 * with the offline-shell download, optional chunks or update checks.
 */
const SHELF_SELECTOR = 'canvas.ihr-bookshelf-scene'
const FIRST_FRAME_DEADLINE_MS = 8000

let presented = null
/** Resolves once the shelf canvas has drawn, or after the deadline (e.g. no WebGL). */
export function shelfPresented() {
  return presented ||= new Promise(resolve => {
    const started = performance.now()
    const check = () => {
      const canvas = document.querySelector(SHELF_SELECTOR)
      if (Number(canvas?.dataset.renderCount) > 0 || performance.now() - started > FIRST_FRAME_DEADLINE_MS) return resolve()
      setTimeout(check, 100)
    }
    check()
  })
}

export function idleSlice({ timeout = 2000 } = {}) {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout })
    else setTimeout(resolve, 50)
  })
}

/** Runs the tasks one per idle slice after the first live frame; a failing task never stops the rest. */
export async function runAfterFirstFrame(tasks) {
  await shelfPresented()
  for (const task of tasks) {
    await idleSlice()
    try { await task() } catch (error) { console.warn('Carga diferida omitida:', error) }
  }
}
