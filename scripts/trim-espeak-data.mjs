// Rebuilds public/neural-voice/phon/ from the piper-tts-web 1.1.2 npm package (MIT; see public/neural-voice/phon/README.md).
//
//   node scripts/trim-espeak-data.mjs <piper-tts-web/package dir> [outDir] [langs]
//
// The package ships piper_phonemize.wasm (the piper-phonemize C++ program built with Emscripten, which statically links
// espeak-ng), piper_phonemize.data (the 18 MB espeak-ng data: one dictionary per language) and a bundled web worker that
// contains the Emscripten JavaScript glue. We keep:
//   - piper_phonemize.wasm  byte for byte,
//   - piper_phonemize.data  only with the dictionaries of the languages we offer (+ every non-dictionary file),
//     the embedded file table of the glue being rewritten to match,
//   - piper_phonemize.mjs   ONLY the Emscripten glue (factory function) of that worker, exported as the default export,
//     without the package's own worker/message wrapper (our own small wrapper is src/js/readers/neural-voice/phonemizer.js).
// Every pattern is checked: if the package changes shape the script fails instead of writing something broken.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const DEFAULT_LANGS = 'es,en,fr,de,it,pt,ca'
const [pkg, outArg, langsArg] = process.argv.slice(2)
if (!pkg) { console.error('usage: node scripts/trim-espeak-data.mjs <piper-tts-web/package dir> [outDir] [langs]'); process.exit(1) }
const out = resolve(outArg || 'public/neural-voice/phon')
const keep = new Set((langsArg || DEFAULT_LANGS).split(','))

const src = readFileSync(join(pkg, 'dist/worker/PhonemizeWebWorker.js'), 'utf8')
const data = readFileSync(join(pkg, 'dist/piper/piper_phonemize.data'))

// 1. file table of the Emscripten data package (filename + byte range of each file inside the .data blob)
const table = /files:\s*\[(.*?)\],\s*remote_package_size: (\d+)/s.exec(src)
if (!table) throw new Error('file table not found in the phonemizer worker')
if (Number(table[2]) !== data.length) throw new Error('remote_package_size does not match piper_phonemize.data')
const items = [...table[1].matchAll(/\{ filename: "([^"]+)", start: (\d+), end: (\d+) \}/g)].map(m => ({ name: m[1], start: +m[2], end: +m[3] }))
if (!items.length) throw new Error('empty file table')

const chunks = [], kept = []
let size = 0
for (const item of items) {
  const file = basename(item.name)
  if (file.endsWith('_dict') && !keep.has(file.slice(0, -5))) continue
  chunks.push(data.subarray(item.start, item.end))
  kept.push({ name: item.name, start: size, end: size + (item.end - item.start) })
  size += item.end - item.start
}
const trimmed = Buffer.concat(chunks)
for (const lang of keep) if (!kept.some(item => basename(item.name) === `${lang}_dict`)) throw new Error(`no dictionary for "${lang}"`)
const entries = kept.map(item => `{ filename: "${item.name}", start: ${item.start}, end: ${item.end} }`).join(', ')
let glue = src.slice(0, table.index) + `files: [${entries}], remote_package_size: ${trimmed.length}` + src.slice(table.index + table[0].length)

// 2. keep only the Emscripten factory: cut the package's wrapper (classes + self.onmessage) and export the factory instead
const marker = 'const kt = (B.exports == null ? {} : B.exports).default || B.exports;'
const at = glue.indexOf(marker)
if (at < 0 || !glue.includes('export default wt();')) throw new Error('worker wrapper not found where expected')
glue = glue.slice(0, at) + 'factory = (B.exports == null ? {} : B.exports).default || B.exports;\n});\nwt();\nexport default factory;\n'
glue = 'let factory;\n' + glue

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'piper_phonemize.data'), trimmed)
writeFileSync(join(out, 'piper_phonemize.mjs'), glue)
copyFileSync(join(pkg, 'dist/piper/piper_phonemize.wasm'), join(out, 'piper_phonemize.wasm'))
console.log(`files ${items.length} -> ${kept.length}, data ${data.length} -> ${trimmed.length} bytes, glue ${glue.length} bytes, langs ${[...keep].join(',')}`)
