// @vitest-environment node
// Microbench of the title search's pixel planes: rust-ui/src/font_planes.rs (the kernels compiled into the
// shelf module) against the frozen bridge to the numeric core it replaced
// (tests/unit/helpers/reference-font-glyph-wasm.js). One mask of a search is a crop of the raster the canvas
// just returned; a cover is prepared once. 121 interleaved rounds, medians of this process's CPU time.
// Not part of the suite. To run it:
//   cp tools/bench/font-planes-bench.test.js tests/unit/zz-font-planes-bench.test.js
//   npx vitest run tests/unit/zz-font-planes-bench.test.js && rm tests/unit/zz-font-planes-bench.test.js
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { needRustShelf } from '../../src/js/rust-shelf.js'
import { rustGlyphMask, rustNearEdgeMap, rustPrepareCoverPixels } from '../../tests/unit/helpers/reference-font-glyph-wasm.js'

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[sorted.length >> 1] }
const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000 }
// Lettering-like alpha: three rows of blocky glyphs inside a transparent canvas.
function title(width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 3; y < height - 3; y++) for (let x = 2; x < width - 2; x++) {
    const inked = (y % 24) < 17 && ((x >> 2) + (y >> 3)) % 3 !== 0
    if (inked) data[(y * width + x) * 4 + 3] = 255
  }
  return data
}
function cover(width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  let s = 7
  for (let i = 0; i < data.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; data[i] = s >>> 24 }
  return data
}

it('font planes: shelf module against the frozen bridge to the core', () => {
  const core = new WebAssembly.Instance(new WebAssembly.Module(readFileSync('src/wasm/inhouse_read_core.wasm'))).exports
  const shelf = needRustShelf()
  const frozenMask = (raw, width, height, rows) => {
    const mask = rustGlyphMask(core, raw, width, height, width)
    if (mask === undefined) throw new Error('Invalid glyph raster')
    return mask && core.font_mask_fits(mask.width, mask.height, width, rows) ? mask : null
  }
  const cases = []
  for (const [width, height] of [[64, 60], [192, 96], [192, 176], [384, 352]]) {
    const raw = title(width, height), rows = height
    cases.push([`mask ${width} x ${height}`, 100, () => frozenMask(raw, width, height, rows), () => shelf.title_glyph_mask(raw, width, height, rows)])
  }
  for (const [width, height, edges] of [[64, 96, true], [192, 288, true], [192, 288, false]]) {
    const raw = cover(width, height)
    cases.push([`planes ${width} x ${height}${edges ? '' : ', no edges'}`, 25, () => rustPrepareCoverPixels(core, raw, width, height, edges),
      () => shelf.cover_pixel_planes(raw, width, height, edges)])
  }
  { const edges = Float32Array.from({ length:192 * 236 }, (_, i) => (i * 37) % 255)
    cases.push(['near edges 192 x 236', 25, () => rustNearEdgeMap(core, edges, 192), () => shelf.near_edge_map(edges, 192)]) }
  const report = []
  for (const [name, count, frozen, native] of cases) {
    for (let i = 0; i < 200; i++) { frozen(); native() }
    const times = { frozen:[], native:[] }
    for (let round = 0; round < 121; round++) for (const [key, run] of round % 2 ? [['native', native], ['frozen', frozen]] : [['frozen', frozen], ['native', native]]) {
      const start = cpu()
      for (let i = 0; i < count; i++) run()
      times[key].push((cpu() - start) * 1000 / count)
    }
    report.push(`${name}: frozen ${median(times.frozen).toFixed(2)} us, shelf ${median(times.native).toFixed(2)} us`)
  }
  console.log(report.join('\n'))
}, 600000)
