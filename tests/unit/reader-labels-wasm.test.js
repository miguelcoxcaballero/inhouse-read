import { describe, expect, it } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import * as frozen from './helpers/reference-reader-labels.js'

// Labels, sizes, the panel description and the shared file name moved to rust-ui reader_labels.rs.
function random(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 } }
function outcome(run) { try { return { value:run() } } catch (error) { return { error:error.constructor.name } } }
const same = (actual, expected) => expect(outcome(actual)).toEqual(outcome(expected))

describe('reader labels in Rust', () => {
  it('labels places exactly like the original', () => {
    const next = random(3), pick = values => values[Math.floor(next() * values.length)]
    const values = [undefined, null, 0, -0, 3, 12.5, '7', '', 'Capítulo 2', '字 📖', '\ud800', NaN, Infinity, -1e21, 1e21, true, [1, 2], { toString:() => 'obj' }]
    for (let i = 0; i < 3000; i++) {
      const locator = pick([undefined, null, { kind:'pdf-page', value:pick(values) }, { kind:'cfi', value:'epubcfi(/6/2)' }, { kind:pick(values) }])
      const place = { locator, section:pick(values), page:pick(values), fraction:pick([0, 0.004, 0.005, 0.015, 0.125, 0.5, 0.995, 1, -0.005, -0.3, '0.25', null, undefined, NaN, 2.675e-3, 1 / 3]) }
      const reader = { pageCount:pick([0, 4, 120, undefined, null, '9', NaN]) }
      same(() => ui.reader_place_label(place, reader), () => frozen.label(place, reader))
    }
    for (const bad of [undefined, null]) same(() => ui.reader_place_label(bad, {}), () => frozen.label(bad, {}))
    same(() => ui.reader_place_label({ section:Symbol('s') }, {}), () => frozen.label({ section:Symbol('s') }, {}))
  })
  it('formats every size like toFixed/Math.round did, including exact halves', () => {
    const sizes = [undefined, null, 0, 1, 511, 512, 513, 1023, 1024, 1536, 2560, 1048575, 1048576, 1101005, 1153434, 1310720, 1415578, 2.5 * 1048576, 1e12, -5, NaN, Infinity, '2000000', '', 'x', true]
    for (let k = 0; k < 4000; k++) sizes.push(Math.floor(k * 1048576 / 40), k * 1024 + 512, k * 104857.6)
    for (const size of sizes) same(() => ui.reader_format_size(size), () => frozen.formatSize(size))
  })
  it('describes books and names shared files exactly like the original', () => {
    const next = random(11), pick = values => values[Math.floor(next() * values.length)]
    for (let i = 0; i < 2000; i++) {
      const record = { title:pick(['A book', '  spaced   title ', '', undefined, '字 📖', '<img onerror=x>']), spineTitleOverride:pick([undefined, '', ' Lomo ', 3]),
        author:pick([undefined, '', 'Ana', { name:'Author' }, ['A', 'B'], null]), metadata:pick([undefined, null, {}, { creator:[{ name:'Writer' }] }, { creator:'Plain' }]),
        format:pick(['PDF', 'EPUB', '', undefined, 'Cbz']), sizeBytes:pick([undefined, 0, 2048, 1310720, 12500 * i, '900']), fileName:pick([undefined, '', 'libro.epub']),
        mimeType:pick([undefined, '', 'application/epub+zip']) }
      const content = { type:pick(['', 'application/pdf', undefined]) }
      same(() => ui.reader_description(record), () => frozen.describe(record))
      same(() => ui.reader_share_file(record, content), () => frozen.shareFile(record, content))
    }
  })
})
