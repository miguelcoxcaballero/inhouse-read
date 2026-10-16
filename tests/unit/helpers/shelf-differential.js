// Shared pieces of the differential tests of the shelf screen: a recording book view, a serialiser for what the
// screen calls on its host, the DOM snapshot and the event helpers. Two implementations (the frozen original in
// reference-bookshelf.js and the production one) play the same script; the logs must be identical.
import { vi } from 'vitest'

/** Lets `ms` milliseconds of the page's clock pass: instantly where the timers are faked, really otherwise. */
export const flush = (ms = 0) => vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(ms) : new Promise(resolve => setTimeout(resolve, ms))

/** A value as text for the log: nodes by tag and identity-free attributes, functions by name, numbers exactly. */
export function show(value, seen = new Set()) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)
  if (typeof value === 'function') return 'fn'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof Node !== 'undefined' && value instanceof Node) return `<${value.nodeName.toLowerCase()}${value.className ? '.' + String(value.className).replace(/\s+/g, '.') : ''}>`
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `Blob(${value.size},${value.type})`
  if (value instanceof Promise) return 'Promise'
  if (seen.has(value)) return '[cycle]'
  seen.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map(item => show(item, seen)).join(',')}]`
    return `{${Object.keys(value).sort().map(key => `${key}:${show(value[key], seen)}`).join(',')}}`
  } finally { seen.delete(value) }
}

/** The document as text, with the per-instance ids of the editor sheet made equal. */
export const snapshot = () => document.body.innerHTML.replace(/ihr-ed-\d+/g, 'ihr-ed-N')

/** A recording view: every method logs its name and arguments; animations finish at once. */
export function recordingView(log, host, book, style, dimensions, extra = {}) {
  const canvas = document.createElement('canvas')
  canvas.dataset.renderer = 'three-mesh'
  host.append(canvas)
  let pose = { x: 0, y: 0, scale: 1, angle: 0, pitch: 0, ...(dimensions.initialPose || {}) }
  const tag = dimensions.shelf ? 'shelf-view' : 'view'
  const note = (name, ...args) => log.push(`${tag}.${name}(${args.map(arg => show(arg)).join(',')})`)
  const motion = (name, frames, timing) => {
    note(name, frames, timing)
    const last = Array.isArray(frames) ? frames.at(-1)?.transform : null
    if (last && typeof last === 'object') pose = { ...pose, ...last }
    return { finished: Promise.resolve(), cancel() { note(`${name}.cancel`) } }
  }
  const view = {
    canvas, ready: Promise.resolve(true),
    draw: (next, options) => { note('draw', next, options); if (next) pose = { ...pose, ...next } },
    getPose: () => ({ ...pose }),
    getPageTheme: () => pose.pageTheme ?? 1,
    setPageTheme: value => { note('setPageTheme', value); pose.pageTheme = value },
    updateAppearance: (...args) => note('updateAppearance', ...args),
    updateSpineAppearance: (...args) => note('updateSpineAppearance', ...args),
    updateEdgeAppearance: (...args) => note('updateEdgeAppearance', ...args),
    updateCoverAppearance: (...args) => note('updateCoverAppearance', ...args),
    updateEditorAppearance: (...args) => note('updateEditorAppearance', ...args),
    updateBookmark: (...args) => { note('updateBookmark', ...args); return true },
    prepareCoverRelief: async () => { note('prepareCoverRelief'); return true },
    setCoverRelief: async relief => { note('setCoverRelief', relief) },
    animate: (frames, timing) => motion('animate', frames, timing),
    animateCoverOpen: options => motion('animateCoverOpen', [{ transform: options?.targetPose }], options),
    animateCoverClose: options => motion('animateCoverClose', [{ transform: options?.targetPose }], options),
    animateBookmark: options => motion('animateBookmark', [], options),
    animateToPage: target => motion('animateToPage', [], target),
    pages: new Set(),
    hasPageSnapshot: snapshot => view.pages.has(snapshot),
    setPageSnapshot: (snapshot, options) => { note('setPageSnapshot', snapshot?.width, options); view.pages.add(snapshot); return true },
    commitPreparedPage: (snapshot, theme) => { note('commitPreparedPage', snapshot?.width, theme); return view.pages.has(snapshot) },
    pageTextures: () => { note('pageTextures'); return ['one', 'two'] },
    uploadPageTexture: texture => note('uploadPageTexture', texture),
    compilePage: () => note('compilePage'),
    preparePagePrograms: async (idle, current) => { note('preparePagePrograms', current()); await idle(); note('preparePagePrograms.again', current()) },
    holdNativeMotionFrame: () => { note('holdNativeMotionFrame'); return () => note('holdNativeMotionFrame.release') },
    alignToPage: () => true,
    releaseToSnapshot: () => note('releaseToSnapshot'),
    dispose: (...args) => { note('dispose', ...args); canvas.remove() },
    ...extra
  }
  return view
}

/** A motion that never finishes by itself; cancelling it rejects `finished` like a Web Animation does. */
export function heldMotion(log, name) {
  let reject
  const finished = new Promise((_, fail) => { reject = fail })
  finished.catch(() => {})
  return { finished, cancel() { log.push(`${name}.cancel`); reject(new DOMException('The animation was aborted', 'AbortError')) } }
}

/**
 * A recording shelf scene: every call is logged with its arguments; the poses it answers and the motion of the
 * returning book come from `config` (`sourcePose`, `dockingPose`, `hold`, `insertion`).
 */
export function recordingScene(log, config = {}) {
  const answers = {
    ...config.answers,
    getBookPose: () => config.sourcePose,
    getReturnPose: () => config.dockingPose,
    returnBook: () => {
      if (config.fail) throw new Error('the scene cannot land the book')
      if (config.insertion === false) return undefined
      return config.hold ? heldMotion(log, 'scene.returnBook') : { finished: Promise.resolve(), cancel() { log.push('scene.returnBook.cancel') } }
    }
  }
  return new Proxy({}, {
    get: (_target, name) => {
      if (typeof name !== 'string' || name === 'then') return undefined
      return (...args) => {
        log.push(`scene.${name}(${args.map(arg => show(arg)).join(',')})`)
        return answers[name]?.(...args)
      }
    }
  })
}

/** Rectangles for the nodes the return flight measures (jsdom has no layout). */
export function stubRects({ layout = false } = {}) {
  const original = Element.prototype.getBoundingClientRect
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
  const indexOf = (node, selector) => [...document.querySelectorAll(selector)].indexOf(node)
  Element.prototype.getBoundingClientRect = function () {
    const name = String(this.className || '')
    if (layout) {
      // A deterministic room: objects side by side along their shelf, shelf rows stacked, the bin at the bottom right.
      if (/\bihr-(spine|plant|lamp)\b/.test(name)) return rect(20 + 34 * indexOf(this, '.ihr-spine, .ihr-plant, .ihr-lamp'), 100, 28, 160)
      if (/\bihr-shelf__row\b/.test(name)) return rect(0, 80 + 130 * indexOf(this, '.ihr-shelf__row'), 390, 140)
      if (/\bihr-shelf-trash\b/.test(name)) return rect(310, 700, 56, 56)
      if (/\bihr-bookshelf__scroll\b/.test(name)) return rect(0, 0, 390, 780)
    }
    if (/\bihr-spine\b/.test(name)) return rect(20, 100, 28, 160)
    if (/ihr-flyout__saved-page/.test(name)) return rect(100, 60, 300, 450)
    if (/ihr-flyout__book\b/.test(name)) return rect(50, 40, 420, 560)
    return original.call(this)
  }
  return () => { Element.prototype.getBoundingClientRect = original }
}

/**
 * Takes the unhandled rejections over from the test runner while a script plays, so that the ones the original leaves
 * unhandled (a failing analysis nobody awaits) are counted and compared instead of failing the run. `stop()` waits a
 * turn for the engine to report them and gives the runner its listeners back.
 */
export function captureUnhandled() {
  const runner = process.listeners('unhandledRejection')
  const seen = []
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', reason => seen.push(String(reason?.message ?? reason)))
  return {
    async stop() {
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))
      process.removeAllListeners('unhandledRejection')
      for (const listener of runner) process.on('unhandledRejection', listener)
      return seen
    }
  }
}

export const fire = (node, type, init = {}) => node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }))
export const setValue = (node, value, type = 'input') => { node.value = value; fire(node, type) }
export const keydown = (node, key, init = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
export const click = node => node.click()
export const q = (selector, root = document) => root.querySelector(selector)
export const qa = (selector, root = document) => [...root.querySelectorAll(selector)]

/** Plays a script of [name, step] pairs on one implementation and returns the whole log. */
export async function play(log, steps, { settle = 0 } = {}) {
  for (const [name, step] of steps) {
    log.push(`## ${name}`)
    try { await step() } catch (error) { log.push(`!! ${name} threw ${error?.name}: ${error?.message}`) }
    await flush(settle)
    log.push(snapshot())
  }
  return log
}

/** The first line where two logs differ, with its neighbours. */
export function firstDifference(expected, actual) {
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index++) {
    if (expected[index] !== actual[index]) {
      return `line ${index}\n--- expected\n${expected.slice(Math.max(0, index - 2), index + 2).join('\n')}\n--- actual\n${actual.slice(Math.max(0, index - 2), index + 2).join('\n')}`
    }
  }
  return null
}
export { vi }

/** Preserve failed transcripts in a fresh temporary directory on any checkout. */
export async function writeShelfDifference(name, expected, actual) {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = mkdtempSync(join(tmpdir(), 'ihr-shelf-diff-'))
  const path = join(directory, `${name.replace(/\W+/g, '-')}.txt`)
  writeFileSync(path, JSON.stringify({ expected, actual }, null, 2))
  return path
}
