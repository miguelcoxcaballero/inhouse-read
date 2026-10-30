// Differential test: the saving of the next launch's first paint (rememberLaunchFrames' save step, now
// rust-ui/src/launch_frames.rs) against the frozen JavaScript it replaced
// (helpers/reference-shelf-launch-cache.js). Both run the same scripted pages: a canvas whose settled state,
// zoom, pan, scroll, size and render count change between the waits, books that change under the save,
// snapshots that fail, a hidden page, a flyout, a loading shelf, stops and pagehides. Every host call, every
// stored frame and every timer are compared.
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rustShelf } from './helpers/rust-shelf-ready.js'
import * as production from '../../src/js/shelf-launch-cache.js'
import * as reference from './helpers/reference-shelf-launch-cache.js'

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const settle = async () => { for (let i = 0; i < 8; i++) { await flush(); await new Promise(resolve => setImmediate(resolve)) } }

function random(seed) {
  let value = seed >>> 0
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 2 ** 32 }
}

// A fake IndexedDB: every put is logged with the frame it stores.
function fakeIndexedDB(log) {
  return {
    open() {
      const request = {}
      queueMicrotask(() => {
        const db = {
          transaction() {
            const tx = {}
            tx.objectStore = () => ({ put(frame, key) {
              log.push(['put', key, { ...frame, image:frame.image && { size:frame.image.size, type:frame.image.type } }])
              const put = {}; queueMicrotask(() => tx.oncomplete?.()); return put
            }, get() { const get = {}; queueMicrotask(() => tx.oncomplete?.()); return get } })
            return tx
          },
          close() { log.push(['close']) }
        }
        request.result = db
        request.onsuccess?.()
      })
      return request
    }
  }
}

async function run(implementation, seed) {
  const pick = random(seed), log = []
  const chance = p => pick() < p
  document.body.innerHTML = ''
  localStorage.clear()
  localStorage.setItem('inhouse-read-theme', 'dark')
  const root = document.createElement('div'), scroll = document.createElement('div'), canvas = document.createElement('canvas')
  scroll.className = 'ihr-bookshelf__scroll'; canvas.className = 'ihr-bookshelf-scene'
  scroll.append(canvas); root.append(scroll); document.body.append(root)
  let hidden = false
  Object.defineProperty(document, 'hidden', { configurable:true, get:() => hidden })
  const state = { renderCount:'3', animating:'false', pending:'0', zoom:undefined, pan:undefined, width:300, height:200, scrollTop:0,
    blob:'png', rect:{ x:0, y:40, width:300, height:200 }, idle:true, books:[{ id:'a', title:'Uno', progressFraction:.25 }] }
  const apply = () => {
    for (const [key, value] of [['renderCount', state.renderCount], ['animating', state.animating], ['bookQualityPending', state.pending],
      ['inspectionZoom', state.zoom], ['inspectionPan', state.pan]]) {
      if (value === undefined) delete canvas.dataset[key]; else canvas.dataset[key] = value
    }
    canvas.width = state.width; canvas.height = state.height
    Object.defineProperty(scroll, 'scrollTop', { configurable:true, get:() => state.scrollTop })
  }
  canvas.getBoundingClientRect = () => { log.push(['rect']); return { ...state.rect } }
  canvas.toBlob = (callback, type) => {
    log.push(['toBlob', type])
    if (state.blob === 'throw') throw new Error('tainted')
    const result = state.blob === 'png' ? new Blob(['pixels'], { type:'image/png' }) : state.blob === 'jpeg' ? new Blob(['x'], { type:'image/jpeg' }) : null
    setTimeout(() => { if (chance(.15)) mutate(); callback(result) }, 0)
  }
  const mutate = () => {
    const step = Math.floor(pick() * 15)
    if (step === 0) state.renderCount = String(Number(state.renderCount) + 1)
    else if (step === 1) state.animating = chance(.5) ? 'true' : 'false'
    else if (step === 2) state.pending = chance(.5) ? '1' : '0'
    else if (step === 3) state.zoom = [undefined, '1', '1.5', ''][Math.floor(pick() * 4)]
    else if (step === 4) state.pan = [undefined, '[0,0]', '[0,-0]', '[3,0]', 'nope', '5', '{}', 'null', '[]'][Math.floor(pick() * 9)]
    else if (step === 5) { state.width = chance(.8) ? 300 : 3000; state.height = chance(.8) ? 200 : 2000 }
    else if (step === 6) state.scrollTop = chance(.7) ? 0 : 12
    else if (step === 7) state.blob = ['png', 'png', 'png', 'null', 'throw', 'jpeg'][Math.floor(pick() * 6)]
    else if (step === 8) state.rect = chance(.7) ? { x:0, y:40, width:300, height:200 } : { x:-4, y:0, width:NaN, height:200 }
    else if (step === 9) state.idle = chance(.75)
    else if (step === 10) state.books = chance(.5) ? [{ id:'a', title:'Uno', progressFraction:.25 }] : [{ id:'a', title:'Uno', progressFraction:.5 }]
    else if (step === 11) hidden = chance(.2)
    else if (step === 12) { const loading = root.querySelector('.ihr-library-loading'); if (loading) loading.remove(); else if (chance(.3)) root.append(Object.assign(document.createElement('div'), { className:'ihr-library-loading' })) }
    else if (step === 13) { const flyout = document.querySelector('.ihr-flyout'); if (flyout) flyout.remove(); else if (chance(.3)) document.body.append(Object.assign(document.createElement('div'), { className:'ihr-flyout' })) }
    else state.renderCount = chance(.1) ? '0' : state.renderCount
    apply()
  }
  apply()
  vi.stubGlobal('indexedDB', fakeIndexedDB(log))
  // The key's SHA-256, answered on the next microtask: WebCrypto's thread pool would settle at a different
  // moment in each run.
  vi.stubGlobal('crypto', { subtle:{ digest:(algorithm, bytes) => Promise.resolve(Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer) } })
  const idle = callback => { log.push(['idle']); setTimeout(callback, 5) }
  const stop = implementation.rememberLaunchFrames(root, {
    books:() => { log.push(['books']); if (chance(.1)) mutate(); return chance(.5) ? Promise.resolve(state.books.map(book => ({ ...book }))) : state.books.map(book => ({ ...book })) },
    idle, isIdle:() => { log.push(['isIdle']); return state.idle },
    shelfModule:() => rustShelf
  })
  for (let step = 0; step < 14; step++) {
    const action = pick()
    if (action < .55) mutate()
    else if (action < .65) canvas.dataset.renderCount = String(Number(canvas.dataset.renderCount || 0) + 1)
    else if (action < .7) dispatchEvent(Object.assign(new Event('pagehide'), { persisted:true }))
    else if (action < .75) dispatchEvent(Object.assign(new Event('pageshow'), { persisted:true }))
    else if (action < .77) stop()
    await settle()
    await vi.advanceTimersByTimeAsync(Math.floor(pick() * 1400))
    await settle()
    log.push(['step', step])
  }
  stop()
  await vi.advanceTimersByTimeAsync(5000); await settle()
  dispatchEvent(Object.assign(new Event('pagehide'), { persisted:false }))
  // Earlier pages keep their (stopped) pageshow listeners, whose idle calls would still reach this array.
  return [...log]
}

beforeEach(() => { vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete document.hidden; document.body.innerHTML = '' })

describe('saving the settled shelf for the next launch, Rust against the frozen JavaScript', () => {
  for (let seed = 1; seed <= 24; seed++) {
    it(`scripted page ${seed}`, async () => {
      const expected = await run(reference, seed)
      const actual = await run(production, seed)
      expect(actual).toEqual(expected)
    })
  }
  it('exercises saved frames and every refusal', async () => {
    const all = []
    for (let seed = 1; seed <= 24; seed++) all.push(...await run(reference, seed))
    expect(all.filter(entry => entry[0] === 'put').length).toBeGreaterThan(3)
    expect(all.filter(entry => entry[0] === 'toBlob').length).toBeGreaterThan(all.filter(entry => entry[0] === 'put').length)
    expect(all.filter(entry => entry[0] === 'isIdle').length).toBeGreaterThan(all.filter(entry => entry[0] === 'toBlob').length)
  })
})
