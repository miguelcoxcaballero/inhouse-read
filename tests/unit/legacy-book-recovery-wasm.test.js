import { describe, it, expect } from 'vitest'
import './helpers/rust-ui-ready.js'
import { restoreLegacyBookBytes } from '../../src/js/legacy-book-recovery.js'
import { restoreLegacyBookBytes as reference } from './helpers/reference-legacy-book-recovery.js'

// The Rust port is compared with the frozen JavaScript original on a seeded
// corpus of libraries, folder answers and failures: every host call, in order,
// and the result or error must be the same.
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]

function scenario(seed) {
  const rng = random(seed)
  const books = Array.from({ length: Math.floor(rng() * 12) }, (_, index) => ({
    id: `book-${index}`,
    sourceType: pick(rng, ['local', 'local', 'local', 'local', 'local', 'drive', undefined]),
    driveFileId: pick(rng, [undefined, undefined, undefined, '', 'drive-1']),
    content: pick(rng, [undefined, undefined, undefined, undefined, undefined, new Blob(['x'])]),
    folderFileName: pick(rng, ['a.epub', 'b.pdf', 'a.epub', 'b.pdf', 'a.epub', '', null, undefined]),
    size: pick(rng, [5, 5, 5, 5, '5', 3, 0, NaN, undefined, null]),
    mimeType: pick(rng, [undefined, 'application/pdf', ''])
  }))
  return {
    books,
    supported: rng() < .9,
    handle: pick(rng, [null, undefined, ...Array(10).fill({ permission: 'granted' }), { permission: 'prompt' }, { permission: 'denied' }, { permission: 'granted', throws: true }]),
    files: { 'a.epub': pick(rng, [null, { size: 5, type: 'application/epub+zip' }, { size: 5, type: 'application/epub+zip' }, { size: 5, type: '' }, { size: 3, type: 'x/y' }, { size: '5', type: '' }, { size: NaN, type: '' }, 'throws']),
      'b.pdf': pick(rng, [null, undefined, { size: 5, type: 'application/pdf' }, { size: 0, type: '' }]) },
    patchFails: pick(rng, [-1, -1, -1, 0, 1]),
    listFails: rng() < .05
  }
}

async function run(restore, s) {
  const log = []
  let patches = 0
  const library = {
    listAll: async () => { log.push('listAll'); if (s.listFails) throw new Error('list'); return s.books },
    patch: async (id, fields) => {
      log.push(['patch', id, Object.keys(fields), fields.content.size, fields.content.type, fields.mimeType, fields.wordCount, fields.wordCountComplete, typeof fields.contentRevision])
      if (patches++ === s.patchFails) throw new Error('patch')
      return {}
    }
  }
  const handle = s.handle && { queryPermission: async options => { log.push(['query', options]); if (s.handle.throws) throw new Error('query'); return s.handle.permission } }
  let outcome
  try {
    outcome = await restore(library, {
      supported: () => { log.push('supported'); return s.supported },
      getHandle: async () => { log.push('handle'); return handle },
      readFile: async (_handle, name) => {
        log.push(['read', name])
        const entry = s.files[name]
        if (entry === 'throws') throw new Error('read')
        // The size is reported independently of the bytes, as a broken folder entry could.
        return entry ? Object.defineProperty(new File(['12345'], name, { type: entry.type }), 'size', { value: entry.size }) : entry
      }
    })
  } catch (error) { outcome = `error:${error.message}` }
  return { outcome, log }
}

describe('restoreLegacyBookBytes (Rust) against the original', () => {
  it('makes the same host calls, patches and result on 600 seeded scenarios', async () => {
    let restoredTotal = 0, errors = 0
    for (let seed = 1; seed <= 600; seed++) {
      const s = scenario(seed)
      const expected = await run(reference, s)
      const actual = await run(restoreLegacyBookBytes, s)
      expect(actual, `seed ${seed}`).toEqual(expected)
      restoredTotal += typeof expected.outcome === 'number' ? expected.outcome : 0
      if (typeof expected.outcome === 'string') errors++
    }
    // The corpus must really exercise restores and failures.
    expect(restoredTotal).toBeGreaterThan(80)
    expect(errors).toBeGreaterThan(30)
  })
})
