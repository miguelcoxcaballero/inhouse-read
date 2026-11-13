import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import './helpers/rust-ui-ready.js'
import * as native from '../../src/js/local-folder-store.js'
import * as original from './helpers/reference-local-folder-store.js'

// The Rust folder store (names in rust-core/src/file_name.rs, the rest in rust-ui/src/folder_store.rs)
// against the frozen JavaScript: file-name cleaning on generated text, and the name search, copy, read-back and
// permission flow on fake directories with every kind of existing file and failure.
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]
const PIECES = ['libro', 'mi libro', ' ', '  ', '\t', '\n', ' ', '﻿', ' ', '　', '᠎', '\u0085', '\\', '/', ':', '*', '?', '"', '<', '>', '|', '||', '..', '.', '.epub', '.pdf',
  '_', '-', 'é', 'ñ', '😀', '\ud800', '\udc00', 'İ', '漢字', '0', 'a'.repeat(40)]
const text = rng => Array.from({ length: Math.floor(rng() * 9) }, () => pick(rng, PIECES)).join('')

class Directory {
  constructor(files, failure) { this.files = new Map(files); this.log = []; this.failure = failure }
  async getFileHandle(name, options = {}) {
    this.log.push(['handle', name, options])
    if (this.failure === 'throws-sync') throw new Error('sync failure')
    if (this.failure === 'denied') { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error }
    if (!this.files.has(name)) {
      if (!options.create) { const error = new Error('not found'); error.name = 'NotFoundError'; throw error }
      this.files.set(name, { size: 0 })
    }
    const entry = this.files.get(name)
    return { getFile: async () => { this.log.push(['getFile', name]); return { size: entry.size, name } },
      createWritable: async () => ({ write: async file => { this.log.push(['write', name, file.size]); entry.size = file.size }, close: async () => { this.log.push(['close', name]) } }) }
  }
}

async function outcome(task) { try { return { value: await task() } } catch (error) { return { error: `${error?.name}:${error?.message}` } } }

describe('local folder store (Rust) against the original', () => {
  it('cleans 30,000 generated file names exactly like the original', () => {
    let changed = 0
    for (let seed = 1; seed <= 30_000; seed++) {
      const name = text(random(seed))
      const expected = original.sanitizeFileName(name)
      expect(native.sanitizeFileName(name), `seed ${seed}: ${JSON.stringify(name)}`).toBe(expected)
      if (expected !== name) changed++
    }
    expect(changed).toBeGreaterThan(5000)
    for (const odd of [undefined, null, 0, 12.5, {}, [], ['a', ':'], true, Symbol.iterator.description, 'x'.repeat(200_000), ':'.repeat(100_000)]) {
      expect(native.sanitizeFileName(odd)).toBe(original.sanitizeFileName(odd))
    }
  })

  it('finds, copies and reads back like the original on 1,500 seeded directories', async () => {
    let collisions = 0, saved = 0, missing = 0
    for (let seed = 1; seed <= 1500; seed++) {
      const rng = random(seed)
      const name = pick(rng, ['dune.epub', 'dune', '.hidden', 'a.b.c.pdf', 'sin extension', 'ünï.cbz', ''])
      const size = pick(rng, [100, 100, 5, 0, '100', NaN])
      const taken = [[name, { size: pick(rng, [100, 999, 5]) }], [`${name.replace(/(\.[^.]*)?$/, '')}-2${name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''}`, { size: pick(rng, [100, 999])}], [`${name.replace(/(\.[^.]*)?$/, '')}-3${name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''}`, { size: 999 }]]
        .filter(() => rng() < .7)
      const failure = pick(rng, [null, null, null, null, 'denied', 'throws-sync'])
      const run = async api => {
        const directory = new Directory(taken.map(([key, entry]) => [key, { ...entry }]), failure)
        const resolved = await outcome(() => api.resolveNonCollidingName(directory, name, size))
        const file = Object.assign(new File(['data'], 'Mi libro: 1/2?.pdf'), { })
        const copy = await outcome(() => api.saveFileIntoFolder(directory, file))
        const read = await outcome(async () => (await api.readFileFromFolder(directory, copy.value || name))?.size ?? null)
        const gone = await outcome(async () => await api.readFileFromFolder(directory, 'nothing-here.pdf'))
        return { resolved, copy, read, gone, log: directory.log, files: [...directory.files.entries()] }
      }
      const expected = await run(original)
      expect(await run(native), `seed ${seed}`).toEqual(expected)
      if (expected.resolved.value && expected.resolved.value !== name) collisions++
      if (expected.copy.value) saved++
      if (expected.gone.value === null) missing++
    }
    expect(collisions).toBeGreaterThan(100)
    expect(saved).toBeGreaterThan(900)
    expect(missing).toBeGreaterThan(900)
  })

  it('asks for the permission like the original, including a refusal that throws', async () => {
    const handles = [null, undefined, { queryPermission: async () => 'granted' }, { queryPermission: async () => 'prompt', requestPermission: async () => 'granted' },
      { queryPermission: async () => 'prompt', requestPermission: async () => 'denied' }, { queryPermission: async () => 'prompt', requestPermission: async () => { throw new Error('gesture') } },
      { queryPermission: async () => 'prompt' }, { queryPermission: async () => { throw new Error('query') } }, { queryPermission: () => 'granted' }]
    for (const handle of handles) {
      const calls = []
      const spy = source => source && Object.fromEntries(Object.entries(source).map(([key, fn]) => [key, (...args) => { calls.push([key, ...args]); return fn(...args) }]))
      const expected = await outcome(() => original.ensureFolderPermission(spy(handle)))
      const expectedCalls = calls.splice(0)
      expect(await outcome(() => native.ensureFolderPermission(spy(handle)))).toEqual(expected)
      expect(calls).toEqual(expectedCalls)
    }
  })
})

// The remembered directory handle and the picker (rust-ui/src/folder_store.rs) against the frozen JavaScript,
// on the test environment's IndexedDB. A stored handle is a structured clone, so the permission methods of
// these stand-ins live on Object.prototype for the length of the test.
describe('remembered folder (Rust) against the original', () => {
  const DB = 'inhouse-read-folder'
  const settled = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => resolve(null) })
  // Neither store closes its connections (a page's live as long as it does): each run gets a browser of its own.
  const wipe = () => { globalThis.indexedDB = new IDBFactory() }
  const stored = async () => {
    const names = (await indexedDB.databases()).map(entry => entry.name)
    if (!names.includes(DB)) return 'no database'
    const db = await settled(indexedDB.open(DB))
    try {
      if (!db.objectStoreNames.contains('handles')) return `v${db.version} without the store`
      const store = db.transaction('handles', 'readonly').objectStore('handles')
      return { version:db.version, keys:await settled(store.getAllKeys()), values:await settled(store.getAll()) }
    } finally { db.close() }
  }
  const seed = async (state, handle) => {
    wipe()
    if (state === 'none') return
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => { if (state !== 'storeless') request.result.createObjectStore('handles') }
    const db = await settled(request)
    if (state === 'saved') { await settled(db.transaction('handles', 'readwrite').objectStore('handles').put(handle, 'library-folder')) }
    db.close()
  }

  it('finds, picks and remembers the folder like the original in every state of the browser', async () => {
    const calls = []
    const methods = {
      queryPermission(options) { calls.push(['query', this.name, options]); if (this.query === 'throw') throw new Error('query failed'); return Promise.resolve(this.query) },
      requestPermission(options) { calls.push(['request', this.name, options]); if (this.request === 'throw') return Promise.reject(new Error('no gesture')); return Promise.resolve(this.request) }
    }
    for (const [name, value] of Object.entries(methods)) Object.defineProperty(Object.prototype, name, { value, configurable:true, writable:true })
    const picker = window.showDirectoryPicker, factory = globalThis.indexedDB
    try {
      const handles = [{ name:'granted', query:'granted' }, { name:'asked', query:'prompt', request:'granted' }, { name:'denied', query:'prompt', request:'denied' },
        { name:'gesture', query:'prompt', request:'throw' }, { name:'broken', query:'throw' }, 0, '', false, 'text', 7]
      const pickers = ['absent', 'not a function', 'picks', 'aborts', 'throws now', 'picks nothing', 'picks what cannot be stored']
      let cases = 0, remembered = 0, reused = 0, failed = 0
      for (const state of ['none', 'empty', 'storeless', 'saved']) for (const handle of state === 'saved' ? handles : [null]) for (const pick of pickers) {
        const run = async api => {
          await seed(state, handle)
          calls.length = 0
          if (pick === 'absent') delete window.showDirectoryPicker
          else if (pick === 'not a function') window.showDirectoryPicker = 'soon'
          else window.showDirectoryPicker = options => {
            calls.push(['picker', options])
            if (pick === 'throws now') throw new TypeError('picker unavailable')
            if (pick === 'aborts') return Promise.reject(Object.assign(new Error('The user aborted a request.'), { name:'AbortError' }))
            if (pick === 'picks nothing') return undefined
            if (pick === 'picks what cannot be stored') return Promise.resolve({ name:'live', open() {} })
            return Promise.resolve({ name:'picked', query:'granted' })
          }
          const supported = api.isFolderApiSupported()
          const saved = await outcome(() => api.getSavedFolderHandle())
          const afterRead = await stored()
          const found = await outcome(() => api.getOrChooseFolder())
          const afterFind = await stored()
          const chosen = await outcome(() => api.chooseFolder())
          return { supported, saved, afterRead, found, afterFind, chosen, afterChoose:await stored(), calls:calls.map(call => JSON.stringify(call)) }
        }
        const expected = await run(original), actual = await run(native), label = `${state} / ${JSON.stringify(handle)} / ${pick}`
        // Calling something that is not a function names the expression in the engine's own words.
        for (const result of [expected, actual]) for (const key of ['found', 'chosen']) if (/is not a function/.test(result[key].error || '')) result[key].error = 'TypeError: not a function'
        expect(actual, label).toEqual(expected)
        cases++
        if (expected.afterChoose.values?.[0]?.name === 'picked') remembered++
        if (expected.found.value && expected.found.value.name !== 'picked') reused++
        if (expected.found.error) failed++
      }
      expect(cases).toBe(91)
      expect(Math.min(remembered, reused, failed)).toBeGreaterThan(1)
    } finally {
      for (const name of Object.keys(methods)) delete Object.prototype[name]
      if (picker === undefined) delete window.showDirectoryPicker; else window.showDirectoryPicker = picker
      globalThis.indexedDB = factory
    }
  })

  it('cleans names with lone surrogates, very long names and other values like the original', () => {
    const rng = random(99)
    const units = [0xD800, 0xDBFF, 0xDC00, 0xDFFF, 0x20, 0xA0, 0xFEFF, 0x2028, 0x3A, 0x2F, 0x5C, 0x7C, 0x61, 0xE9, 0x180E, 0x85, 0x3000, 0xD83D, 0xDE00, 0]
    for (let trial = 0; trial < 4000; trial++) {
      const name = String.fromCharCode(...Array.from({ length:Math.floor(rng() * 14) }, () => pick(rng, units)))
      expect(native.sanitizeFileName(name), JSON.stringify(name)).toBe(original.sanitizeFileName(name))
    }
    for (const long of ['\ud800' + 'a:'.repeat(9000), ' '.repeat(8193) + '\udc00' + '/'.repeat(8193) + 'b'.repeat(8193), 'é'.repeat(20_000) + ' ', '😀'.repeat(8192) + '*'])
      expect(native.sanitizeFileName(long)).toBe(original.sanitizeFileName(long))
    for (const odd of [NaN, -0, 10n, new String(' a:b '), { toString:() => '  <x>  ' }, [' ', '?']]) expect(native.sanitizeFileName(odd)).toBe(original.sanitizeFileName(odd))
    expect(native.sanitizeFileName(Symbol('a/b'))).toBe(original.sanitizeFileName(Symbol('a/b')))
    const thrower = { toString() { throw new RangeError('no name') } }
    expect(() => original.sanitizeFileName(thrower)).toThrow(RangeError)
    expect(() => native.sanitizeFileName(thrower)).toThrow(RangeError)
  })
})
