import { describe, it, expect } from 'vitest'
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
