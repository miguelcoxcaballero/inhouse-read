// Differential test: the «Sin avisos al leer» switch of rust-ui/src/reading_focus.rs against the frozen
// JavaScript it replaced (helpers/reference-reading-focus.js). Both bind to the same scripted pages:
// bridges with and without support, a missing switch, row or hint, states that are malformed or throw,
// setEnabled/openAccess that throw, clicks, focus and visibility changes, and the returned unbind. The
// markup, the bridge calls and every thrown error are compared step by step.
import { afterEach, describe, expect, it } from 'vitest'
import './helpers/rust-shelf-ready.js'
import { bindReadingFocus } from '../../src/js/reading-focus.js'
import { bindReadingFocus as reference } from './helpers/reference-reading-focus.js'

function random(seed) {
  let value = seed >>> 0
  return () => { value = (value * 1103515245 + 12345) >>> 0; return value / 2 ** 32 }
}

const pages = [
  `<label data-reading-focus-setting hidden><input id="reading-focus-toggle" type="checkbox" /></label><p id="reading-focus-hint" hidden></p>`,
  `<label data-reading-focus-setting hidden><input id="reading-focus-toggle" type="checkbox" /></label>`,
  `<input id="reading-focus-toggle" type="checkbox" /><p id="reading-focus-hint" hidden></p>`,
  `<p id="reading-focus-hint" hidden></p>`
]
const states = [
  () => JSON.stringify({ supported:true, enabled:true, access:false }),
  () => JSON.stringify({ supported:true, enabled:false, access:true }),
  () => JSON.stringify({ supported:true, enabled:true, access:true }),
  () => JSON.stringify({ supported:false }),
  () => 'not json', () => 'null', () => '0', () => '5', () => undefined,
  () => { throw new Error('state failed') }
]

async function script(bind, seed) {
  const pick = random(seed), chance = p => pick() < p, log = []
  document.body.innerHTML = pages[Math.floor(pick() * pages.length)]
  delete window.InhouseReadingFocus
  let current = { supported:true, enabled:chance(.5), access:chance(.5) }
  let override = null
  if (chance(.9)) {
    window.InhouseReadingFocus = chance(.05) ? { state:'no' } : {
      state() { log.push(['state']); return override ? override() : JSON.stringify(current) },
      setEnabled(value) { log.push(['setEnabled', value]); if (chance(.1)) throw new Error('setEnabled failed'); current.enabled = value },
      openAccess() { log.push(['openAccess']); if (chance(.1)) throw new Error('openAccess failed') }
    }
    if (chance(.15)) override = states[Math.floor(pick() * states.length)]
  }
  const snapshot = () => log.push(['markup', document.body.innerHTML, document.getElementById('reading-focus-toggle')?.checked ?? null])
  const attempt = run => { try { run() } catch (error) { log.push(['error', error.message]) } }
  let release = () => {}
  attempt(() => { release = bind(document) })
  snapshot()
  for (let step = 0; step < 12; step++) {
    const roll = pick()
    if (roll < .35) attempt(() => document.getElementById('reading-focus-toggle')?.click())
    else if (roll < .5) { current.access = !current.access; attempt(() => window.dispatchEvent(new Event('focus'))) }
    else if (roll < .65) {
      Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => chance(.5) ? 'visible' : 'hidden' })
      attempt(() => document.dispatchEvent(new Event('visibilitychange')))
      delete document.visibilityState
    } else if (roll < .75) override = chance(.5) ? null : states[Math.floor(pick() * states.length)]
    else if (roll < .8) attempt(() => release())
    else current = { supported:true, enabled:chance(.5), access:chance(.5) }
    snapshot()
  }
  attempt(() => release())
  return log
}

afterEach(() => { delete window.InhouseReadingFocus; document.body.innerHTML = '' })

describe('the reading-focus switch in rust-ui/src/reading_focus.rs against the frozen JavaScript', () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`scripted page ${seed}`, async () => {
      const expected = await script(reference, seed)
      const actual = await script(bindReadingFocus, seed)
      expect(actual).toEqual(expected)
    })
  }
  it('covers bound switches, permission requests, hints and failures', async () => {
    const all = []
    for (let seed = 1; seed <= 60; seed++) all.push(...await script(reference, seed))
    for (const kind of ['setEnabled', 'openAccess', 'state']) expect(all.some(entry => entry[0] === kind)).toBe(true)
    expect(all.some(entry => entry[0] === 'markup' && entry[1].includes('<p id="reading-focus-hint"></p>'))).toBe(true)
    expect(all.some(entry => entry[0] === 'markup' && entry[1].startsWith('<label data-reading-focus-setting="">'))).toBe(true)
  })
})
