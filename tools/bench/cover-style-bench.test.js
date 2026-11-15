// @vitest-environment node
// Microbench of a cover's colour: rust-ui/src/cover_style.rs (the shelf module samples the pixels and clusters
// them natively) against the frozen bridge to the numeric core it replaced
// (tests/unit/helpers/reference-cover-color-wasm.js). Interleaved rounds, medians of this process's CPU time.
// Not part of the suite. To run it:
//   cp tools/bench/cover-style-bench.test.js tests/unit/zz-cover-style-bench.test.js
//   npx vitest run tests/unit/zz-cover-style-bench.test.js && rm tests/unit/zz-cover-style-bench.test.js
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { coverColorFromPixels } from '../../src/js/cover-appearance.js'
import { rustCoverColor } from '../../tests/unit/helpers/reference-cover-color-wasm.js'
import { createCoverColorPixels } from '../../tests/helpers/cover-color-cases.mjs'

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[sorted.length >> 1] }
it('cover colour: shelf module against the frozen bridge', async () => {
  const core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports
  const frozen = (data, width, height) => {
    if (!data || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
    const style = rustCoverColor(core, data, width, height)
    if (!style) throw new Error('Invalid cover pixels')
    return style
  }
  const report = {}
  for (const [width, height, kind, repeat] of [[24, 32, 'noise', 400], [71, 101, 'noise', 40], [64, 96, 'split', 100], [192, 288, 'split', 60], [192, 288, 'noise', 60],
    [192, 288, 'mixed-alpha', 60], [192, 288, 'alpha', 60], [512, 512, 'noise', 40], [1200, 1800, 'noise', 40]]) {
    const data = createCoverColorPixels({ width, height, kind }), sides = { frozen, shelf:coverColorFromPixels }, times = { frozen:[], shelf:[] }
    let check = ''
    for (let round = 0; round < 121; round++) for (const side of round % 2 ? ['shelf', 'frozen'] : ['frozen', 'shelf']) {
      const run = sides[side], cpu = process.cpuUsage()
      let last
      for (let i = 0; i < repeat; i++) last = run(data, width, height)
      const used = process.cpuUsage(cpu)
      if (round > 10) times[side].push((used.user + used.system) / repeat)
      check ||= last.color; if (last.color !== check) throw new Error('different colour')
    }
    report[`${width} x ${height} ${kind}`] = `frozen ${median(times.frozen).toFixed(2)} us, shelf ${median(times.shelf).toFixed(2)} us`
  }
  console.log('COVER-STYLE-BENCH ' + JSON.stringify(report, null, 1))
}, 600_000)
