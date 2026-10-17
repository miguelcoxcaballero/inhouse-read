import { describe, expect, it } from 'vitest'
import * as native from '../../src/js/book-length.js'
import * as frozen from './helpers/reference-book-length.js'
import { rustShelf, shelfWasm } from './helpers/rust-shelf-ready.js'

const random = seed => () => { seed = Math.imul(seed ^ seed >>> 15, 0x2c1b3c6d); seed = Math.imul(seed ^ seed >>> 12, 0x297a2d39); return (seed ^= seed >>> 15) >>> 0 }
async function session(module, chunks, language, cancelAt = Infinity) {
  const calls = []; let yields = 0
  const counter = module.createWordCounter(language, {
    isActive() { calls.push(`active:${yields}`); return yields < cancelAt },
    async yieldTask() { calls.push(`yield:${++yields}`) }
  })
  const outcomes = []
  for (const chunk of chunks) outcomes.push(await counter.add(chunk))
  outcomes.push(counter.finish(), counter.finish())
  return { outcomes, calls }
}

describe('native complete text counting against the frozen counter', () => {
  it('preserves chunk boundaries, yields, cancellation and repeated finish for every supported script', async () => {
    const samples = [
      ['es', 'hola mundo e\u0301clair 🪴 libros. '], ['zh', '这是一本关于阅读和故事的书。'],
      ['ja', '読書と物語についての本です。'], ['th', 'หนังสือเกี่ยวกับการอ่านและเรื่องราว'],
      ['not_a_language', 'a\ud800b—c\udc00d, 新しい 本 ']
    ]
    for (const [language, sample] of samples) for (const cancelAt of [Infinity, 1, 3]) {
      const text = sample.repeat(1800)
      const chunks = [text.slice(0, 117), text.slice(117, 17003), text.slice(17003)]
      expect(await session(native, chunks, language, cancelAt)).toEqual(await session(frozen, chunks, language, cancelAt))
    }
    const artificial = ['a'.repeat(40000), 'a'.repeat(40000), ' tail']
    expect(await session(native, artificial, 'en')).toEqual(await session(frozen, artificial, 'en'))
  }, 60_000)

  it('preserves counts for seeded short fragments, punctuation, combining marks and lone UTF-16 surrogates', async () => {
    const next = random(0x1badb002)
    const words = ['one', 'dos', '三', 'かな', 'ภาษา', 'a\u0301', '\ud800', '\udc00', '\r\n', ' ', '—', '🪴', "l'amour", 'x-y']
    for (let run = 0; run < 100; run++) {
      const chunks = Array.from({ length: 8 }, () => Array.from({ length: 15 }, () => words[next() % words.length]).join(''))
      const language = run % 2 ? 'en' : 'not_a_language'
      expect(await session(native, chunks, language)).toEqual(await session(frozen, chunks, language))
    }
  }, 30_000)

  it('does not retain a native counter graph after complete or cancelled text scans', async () => {
    const options = { yieldTask: async () => {} }
    for (let warm = 0; warm < 3; warm++) await native.countTextWords('word '.repeat(5000), options)
    const handles = rustShelf.shelf_live_handles(), callbacks = rustShelf.shelf_pending_callbacks()
    const capacity = shelfWasm.memory.buffer.byteLength
    for (let run = 0; run < 20; run++) {
      expect(await native.countTextWords('word '.repeat(5000), options)).toBe(5000)
      expect(await native.countTextWords('word '.repeat(5000), { ...options, isActive: () => false })).toBeNull()
    }
    expect(rustShelf.shelf_live_handles()).toBe(handles)
    expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks)
    expect(shelfWasm.memory.buffer.byteLength).toBe(capacity)
  }, 30_000)
})

it('preserves lazy metadata reads, repeated wordCount getters and thrown getters', () => {
  for (const name of ['hasCompleteWordCount', 'printedPageCount']) {
    const run = module => {
      const reads = []; let count = 300;
      const record = new Proxy({wordCountVersion:2,wordCountComplete:true},{get(target,key){
        reads.push(key); return key === 'wordCount' ? count++ : target[key];
      }});
      return {result:module[name](record),reads};
    };
    expect(run(native)).toEqual(run(frozen));
    const broken = {get wordCount(){throw new Error('failed count getter')}};
    expect(() => native[name](broken)).toThrow('failed count getter');
  }
});

it('preserves absolute final whitespace boundaries including CRLF and UTF-16 split points',async()=>{
 for(const boundary of ['\r\n','\n','\u2028','\u00a0','\uFEFF']){
  const prefix='word '.repeat(3277).slice(0,16384-boundary.length)+boundary;
  const chunks=[prefix,'新しい本\ud800word '.repeat(1800),' tail'];
  expect(await session(native,chunks,'en')).toEqual(await session(frozen,chunks,'en'));
 }
});
