// Differential test: the Rust display controller (rust-ui/src/reading_display.rs) against the frozen
// JavaScript it replaced (helpers/reference-reading-display.js). Both run the same scripted pages:
// reader classes, visibility, focus, bfcache, catalogue/update overlays, paper and theme changes, and
// wake locks that are granted, refused or released by the system. Every bridge call, lock request and
// release is logged with the step it happened in; the logs must be identical.
import { afterEach, describe, expect, it } from 'vitest'
import { initReadingDisplay } from '../../src/js/reading-display.js'
import { initReadingDisplay as referenceDisplay } from './helpers/reference-reading-display.js'

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const random = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const CLASSES = ['is-reading', 'is-opening-reader', 'is-closing-reader', 'is-reader-page-arriving', 'is-reader-page-leaving']
const BRIDGES = ['none', 'legacy', 'ownership', 'stable', 'stable-throwing']

let visibility = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable:true, get:() => visibility })
afterEach(() => { delete window.InhouseNative; document.body.className = ''; document.body.replaceChildren() })

function page(seed, bridgeKind, lockKind) {
  const log = []
  let step = 0, refuse = false
  const record = (...entry) => log.push([step, ...entry])
  const bridge = {}
  if (bridgeKind !== 'none') bridge.setReadingMode = value => record('mode', value)
  if (bridgeKind !== 'none' && bridgeKind !== 'legacy') bridge.setReaderOwnership = value => record('owner', value)
  if (bridgeKind.startsWith('stable')) {
    bridge.getSafeTopInset = () => 24
    bridge.setStatusBarAppearance = value => {
      record('icons', value)
      if (bridgeKind === 'stable-throwing' && value === false) throw new Error('no icon control')
    }
  }
  const locks = []
  const nav = lockKind === 'none' ? {} : { wakeLock:{ request:kind => {
    record('request', kind)
    if (refuse || lockKind === 'refused') return Promise.reject(new Error('refused'))
    const lock = new EventTarget(), id = locks.length
    lock.release = () => { record('release', id); lock.dispatchEvent(new Event('release')); return Promise.resolve() }
    locks.push(lock)
    return Promise.resolve(lock)
  } } }
  const next = random(seed)
  const actions = Array.from({ length:28 }, () => Math.floor(next() * 12))
  return { log, bridge, nav, locks, actions, next,
    setStep(value) { step = value }, setRefuse(value) { refuse = value } }
}

async function run(init, seed, bridgeKind, lockKind) {
  visibility = 'visible'
  document.body.className = ''; document.body.replaceChildren()
  document.documentElement.setAttribute('data-theme', 'light')
  const screen = document.createElement('div'); screen.id = 'reader-screen'; document.body.append(screen)
  const script = page(seed, bridgeKind, lockKind)
  window.InhouseNative = script.bridge
  const display = init({ document, window, navigator:script.nav })
  await settle()
  let index = 0
  for (const action of script.actions) {
    script.setStep(++index)
    const pick = script.next()
    switch (action) {
      case 0: case 1: case 2: {
        const classes = CLASSES.filter(() => script.next() < 0.45)
        document.body.className = classes.join(' ')
        break
      }
      case 3: visibility = visibility === 'hidden' ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); break
      case 4: window.dispatchEvent(new Event('focus')); break
      case 5: window.dispatchEvent(new Event(pick < 0.5 ? 'pagehide' : 'pageshow')); break
      case 6: document.dispatchEvent(new Event('pointerdown')); break
      case 7: document.documentElement.setAttribute('data-theme', pick < 0.5 ? 'dark' : 'light'); break
      case 8: {
        const open = document.querySelector('dialog.ihr-plant-catalog')
        if (open) open.remove()
        else {
          const dialog = document.createElement('dialog'); dialog.className = 'ihr-plant-catalog'
          if (pick < 0.5) dialog.setAttribute('data-catalog-camera', '')
          document.body.append(dialog); dialog.setAttribute('open', '')
        }
        break
      }
      case 9: {
        const notice = document.getElementById('inhouse-services-update')
        if (notice) notice.remove()
        else { const node = document.createElement('div'); node.id = 'inhouse-services-update'; document.body.append(node) }
        break
      }
      case 10: screen.style.colorScheme = pick < 0.33 ? 'light' : pick < 0.66 ? 'dark' : ''; screen.dataset.readingTheme = String(pick); break
      default: {
        // The system takes the lock back (battery saver, screen off) or starts refusing new ones.
        const lock = script.locks.at(-1)
        if (lock && pick < 0.6) lock.dispatchEvent(new Event('release'))
        else script.setRefuse(pick > 0.8)
      }
    }
    await settle()
  }
  script.setStep('dispose')
  display.dispose(); display.dispose()
  await settle()
  document.body.className = 'is-reading'; window.dispatchEvent(new Event('focus')); await settle()
  return script.log
}

describe('Rust reading display matches the frozen JavaScript controller', () => {
  for (const bridgeKind of BRIDGES) {
    for (const lockKind of ['granted', 'refused', 'none']) {
      it(`${bridgeKind} shell, ${lockKind} wake lock`, async () => {
        for (let seed = 1; seed <= 12; seed++) {
          const expected = await run(referenceDisplay, seed * 7919 + bridgeKind.length, bridgeKind, lockKind)
          const actual = await run(initReadingDisplay, seed * 7919 + bridgeKind.length, bridgeKind, lockKind)
          expect(actual, `seed ${seed}`).toEqual(expected)
        }
      })
    }
  }
  it('still exercises locks, icons and ownership', async () => {
    const kinds = new Set()
    for (let seed = 1; seed <= 12; seed++) for (const entry of await run(initReadingDisplay, seed * 7919 + 6, 'stable', 'granted')) kinds.add(entry[1])
    expect([...kinds].sort()).toEqual(['icons', 'owner', 'release', 'request'])
  })
})
