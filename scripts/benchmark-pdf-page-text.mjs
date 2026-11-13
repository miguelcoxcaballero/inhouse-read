// Speed of extractPDFText: the one-pass page (rust-core pdf_page_text) against the four-stage
// pipeline it replaced, taken from a git revision (default origin/main~0 of the last release that
// had it: pass another as the first argument). Interleaved rounds, medians, same pages, same core.
//   node scripts/benchmark-pdf-page-text.mjs [revision]
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url)), revision = process.argv[2] || '82bf0648'
const { instance } = await WebAssembly.instantiate(await readFile(join(root, 'src/wasm/inhouse_read_core.wasm')), {})
// PROFILE=1 also prints the time spent inside each core export (both pipelines together).
const spent = {}, profiled = !process.env.PROFILE ? instance.exports : Object.fromEntries(Object.entries(instance.exports).map(([name, value]) =>
  [name, typeof value !== 'function' ? value : (...args) => { const start = performance.now(); try { return value(...args) } finally { spent[name] = (spent[name] || 0) + performance.now() - start } }]))
globalThis.__benchmarkCore = () => profiled
const directory = await mkdtemp(join(tmpdir(), 'pdf-page-text-bench-'))
const stubs = { 'rust-core.js':'export const getRustCore=()=>globalThis.__benchmarkCore()\n', 'rust-ui-required.js':'export const readerUI=()=>{throw new Error("no ui")}\n' }
async function load(name, read, files) {
  const base = join(directory, name)
  await mkdir(join(base, 'readers/neural-voice'), { recursive:true })
  for (const [file, text] of Object.entries(stubs)) await writeFile(join(base, file === 'rust-core.js' ? file : `readers/${file}`), text)
  for (const file of files) await writeFile(join(base, file), await read(`src/js/${file}`))
  return (await import(pathToFileURL(join(base, 'readers/pdf-text.js')))).extractPDFText
}
const before = await load('before', path => execFileSync('git', ['show', `${revision}:${path}`], { cwd:root, encoding:'utf8' }),
  ['host-math.js', 'readers/pdf-text.js', 'readers/pdf-row-layout-wasm.js', 'readers/pdf-order-wasm.js', 'readers/pdf-stream-wasm.js', 'readers/core-required.js', 'readers/neural-voice/core-call.js'])
const after = await load('after', path => readFile(join(root, path), 'utf8'), ['host-math.js', 'readers/pdf-text.js', 'readers/core-required.js'])

function random(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 } }
const words = ['Hola', 'mundo.', 'café', 'continua-', 'ción', 'pala­', 'bra', '日本語。', 'de', 'la', 'lectura', 'página', '12', '• ', 'Capítulo']
// A page of `count` items: two columns of prose, each line a run of adjacent items of a few words
// (as PDF.js reports text), in a type size that fits the page, painted partly out of order.
function page(count, seed, apart = 0) {
  const next = random(seed), items = [], perLine = 5, lines = Math.ceil(count / perLine / 2), size = Math.min(10, 720 / lines * 0.8)
  for (let index = 0, x = 0; index < count; index++) {
    const line = Math.floor(index / perLine), column = line >= lines ? 1 : 0, row = line % lines, piece = index % perLine
    const str = words[Math.floor(next() * words.length)] + ' ' + words[Math.floor(next() * words.length)] + (next() < 0.7 ? ' ' : ''), width = str.length * size * 0.5
    if (!piece) x = 40 + column * 280
    items.push({ str, dir:'ltr', width, height:size, fontName:'g_d0_f1', hasEOL:piece === perLine - 1,
      transform:[size, 0, 0, size, x, 780 - row * (720 / lines)] })
    x += width + (apart || (next() < 0.2 ? size * 0.3 : 0))
  }
  for (let i = 0; i < count; i += 7) { const j = Math.floor(next() * count); [items[i], items[j]] = [items[j], items[i]] }
  return { items }
}
const view = { transform:[1, 0, 0, -1, 0, 800] }
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1]
const book = Array.from({ length:300 }, (_, index) => page(180 + (index * 37) % 420, 900 + index))
// The last case is a table: every item its own line, where the kernels' own work dominates.
const cases = [['page of 300 items', [page(300, 1)], 400], ['table of 300 cells', [page(300, 3, 40)], 200], ['page of 5000 items', [page(5000, 2)], 12], ['book of 300 pages (180-600 items)', book, 1]]
for (const [name, pages, repeats] of cases) {
  for (const content of pages) assert.deepEqual(after(content, view), before(content, view))
  const run = extract => { const start = performance.now(); for (let r = 0; r < repeats; r++) for (const content of pages) extract(content, view); return (performance.now() - start) / repeats }
  for (let warm = 0; warm < 6; warm++) { run(before); run(after) }
  const times = { before:[], after:[] }
  for (const name in spent) delete spent[name]
  for (let round = 0; round < 21; round++) {
    if (round % 2) { times.after.push(run(after)); times.before.push(run(before)) } else { times.before.push(run(before)); times.after.push(run(after)) }
  }
  const a = median(times.before), b = median(times.after)
  if (process.env.PROFILE) console.log(Object.entries(spent).map(([key, value]) => `${key} ${(value / 21 / repeats).toFixed(3)}`).join(', '))
  console.log(`${name}: four stages ${a.toFixed(3)} ms, one pass ${b.toFixed(3)} ms (${(b / a * 100).toFixed(1)} %)`)
}
await rm(directory, { recursive:true, force:true })
