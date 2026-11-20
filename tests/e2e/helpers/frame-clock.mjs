// Waits for work the app does on its frames, timed on the pages' own clock rather than the wall clock.
//
// The room advances on animation frames: a held book is read, sent and drawn once per frame, a view turn
// steps at most 50 ms per frame, and a synced shelf is built in frame callbacks. Headless Chrome on a
// software-GL runner composites without a GPU: SwiftShader draws and reads back every WebGL canvas, and
// while it is behind, the compositor stops asking for frames. requestAnimationFrame then fires 0.1-9 s
// apart with the main thread idle (profiles of these specs: 39-48 s of such gaps in a 41-48 s wait, with
// 7-9 s of script). A wall-clock budget there measures the runner's GPU emulation, not the app.
//
// This clock is the wall clock minus that compositor wait: every gap between two frames of a watched page
// counts up to 100 ms (the motions' own step limit), the rest of the gap does not, and any script that ran
// in it (Long Animation Frames attribution, any watched page) counts in full. Timers, network, promises and
// idle time count in full, since a page that is waiting keeps producing cheap frames; a gap that has not
// ended yet also counts in full. On a machine with a GPU the clock is the wall clock.
const STEP = 100

const install = () => {
  if (globalThis.__frameClock) return
  const clock = globalThis.__frameClock = { frames:[], scripts:[] }
  const at = time => performance.timeOrigin + time
  const tick = time => { clock.frames.push(at(time)); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) for (const script of entry.scripts) clock.scripts.push([at(script.startTime), at(script.startTime + script.duration)])
  }).observe({ type:'long-animation-frame' })
}

/** Records the page's frames from now on, and in every document it loads later. */
export async function watchFrames(page) {
  await page.addInitScript(install)
  if (page.url() !== 'about:blank') await page.evaluate(install)
}

function merge(spans) {
  const out = []
  for (const [start, end] of spans.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end); else out.push([start, end])
  }
  return out
}
const length = spans => spans.reduce((sum, [start, end]) => sum + end - start, 0)
function overlap(a, b) {
  const out = []
  for (const [s1, e1] of a) for (const [s2, e2] of b) { const start = Math.max(s1, s2), end = Math.min(e1, e2); if (end > start) out.push([start, end]) }
  return merge(out)
}

/** Milliseconds on the watched pages' clock since `since` (a Date.now() value), until now or until `until`
 * (a Date.now() value in the past, for a span the pages already timed). */
export async function frameClockSince(pages, since, until = Date.now()) {
  const now = until, stalls = [], scripts = []
  for (const page of pages) {
    const { frames, spans } = await page.evaluate(since => {
      const clock = globalThis.__frameClock
      if (!clock) return { frames:[], spans:[] }
      const first = clock.frames.findLastIndex(time => time < since)
      return { frames:clock.frames.slice(Math.max(0, first)), spans:clock.scripts.filter(([, end]) => end > since) }
    }, since)
    for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] > STEP) stalls.push([Math.max(since, frames[i - 1] + STEP), Math.min(now, frames[i])])
    scripts.push(...spans)
  }
  const stalled = merge(stalls)
  return now - since - (length(stalled) - length(overlap(stalled, merge(scripts))))
}

/** Waits until `ready()` holds, failing once `budget` ms have passed on the watched pages' clock. */
export async function waitOnFrameClock(pages, ready, budget, what) {
  const since = Date.now()
  for (;;) {
    // The clock is read after the check: a check that a busy page answers late is not on time.
    const done = await ready(), spent = await frameClockSince(pages, since)
    if (spent > budget) throw new Error(`${what}: not within ${budget} ms of frame clock (${Math.round(spent)} ms frame clock, ${Date.now() - since} ms wall${done ? ', seen late' : ''})`)
    if (done) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
