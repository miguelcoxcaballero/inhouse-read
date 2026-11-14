// @vitest-environment node
// Microbench of the cover analyser: rust-ui/src/cover_appearance.rs against the frozen JavaScript it replaced
// (tests/unit/helpers/reference-cover-appearance-orchestration.js). The canvases are stubs that cost almost
// nothing, so what is timed is the orchestration and the numeric core both sides share, which is the worst
// case for the Rust side (in a browser the rasters and getImageData dominate). Interleaved rounds, medians of
// wall time and of this process's CPU time (the steadier of the two on a busy machine).
// A slice that reaches 2 ms hands the thread back through a real MessageChannel, which costs Node about a
// millisecond: the report counts those yields, and a case is only comparable when both sides made the same
// number (the searches use a 64 x 96 cover so that no family reaches 2 ms on either side).
// Not part of the suite. To run it:
//   cp tools/bench/cover-appearance-bench.test.js tests/unit/zz-cover-appearance-bench.test.js
//   npx vitest run tests/unit/zz-cover-appearance-bench.test.js && rm tests/unit/zz-cover-appearance-bench.test.js
import { it, vi } from 'vitest'
import { scoreFontMask } from '../../src/js/font-score-core.js'
vi.mock('../../src/js/rust-shelf.js', async () => (await import('../../tests/unit/helpers/rust-shelf-real.js')).rustShelfMock())

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[sorted.length >> 1] }
const drain = task => { let step = task.next(); while (!step.done) step = task.next(); return step.value }
let yields = 0, natural = [192, 288]
function canvas() {
  const node = { width:0, height:0 }, context = {
    image:false, drawImage() { this.image = true }, clearRect() {}, fillText() {},
    measureText(text) { return { width:String(text).length * 3 } },
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4)
      if (this.image) for (let i = 0; i < data.length; i += 4) { data[i] = 80 + (i >> 2) % 7; data[i + 1] = 120; data[i + 2] = 200; data[i + 3] = 255 }
      else for (let y = 3; y < 17; y++) for (let x = 3; x < 15; x++) if (x < 7 || y < 7 || ((x + y) % 4 === 0)) data[(y * width + x) * 4 + 3] = 255
      return { data }
    }
  }
  node.getContext = () => context
  return node
}
// A Worker that answers on the next microtask with the scores the real one would send.
class InstantWorker {
  postMessage(message) {
    const { type, job, request } = message
    if (type === 'begin') { this.context = message; queueMicrotask(() => this.onmessage?.({ data:{ type, job, request, accepted:true } })) }
    else if (type === 'scores') {
      const { gray, near, width, height, rows } = this.context
      const scores = message.masks.map(mask => drain(scoreFontMask(gray, near, width, height, rows, mask)))
      queueMicrotask(() => this.onmessage?.({ data:{ type, job, request, scores } }))
    }
  }
  terminate() {}
}

it('cover analyser: Rust orchestration against the frozen JavaScript', async () => {
  const RealChannel = MessageChannel
  vi.stubGlobal('MessageChannel', class extends RealChannel { constructor() { super(); yields++ } })
  vi.stubGlobal('Image', class { naturalWidth = natural[0]; naturalHeight = natural[1]; decode() { return Promise.resolve() } set src(value) { this.url = value } })
  vi.stubGlobal('document', { createElement:() => canvas(), fonts:{ load:() => Promise.resolve([]) } })
  const { requireRustCore } = await import('../../src/js/rust-core.js'); await requireRustCore()
  const reference = await import('../../tests/unit/helpers/reference-cover-appearance-orchestration.js')
  const candidate = await import('../../src/js/cover-appearance.js')
  const colour = { matchFont:false }
  const cases = [
    ['colour only, 192 x 288, x200', [192, 288], undefined, async module => { for (let i = 0; i < 200; i++) await module.analyzeCoverAppearance('blob:a', 'Alpha beta', colour) }],
    ['colour only, 40 at once', [192, 288], undefined, module => Promise.all(Array.from({ length:40 }, () => module.analyzeCoverAppearance('blob:a', 'Alpha beta', colour)))],
    ['aspect ratio x500', [192, 288], undefined, async module => { for (let i = 0; i < 500; i++) await module.readCoverAspectRatio('blob:a') }],
    ['search, 144 masks, Worker scores, x5', [64, 96], InstantWorker, async module => { for (let i = 0; i < 5; i++) await module.analyzeCoverAppearance('blob:a', 'Alpha beta gamma') }],
    ['search, 72 masks, Worker scores, x5', [64, 96], InstantWorker, async module => { for (let i = 0; i < 5; i++) await module.analyzeCoverAppearance('blob:a', 'ALPHA BETA') }],
    ['search, 144 masks, main-thread scorer, x5', [64, 96], undefined, async module => { for (let i = 0; i < 5; i++) await module.analyzeCoverAppearance('blob:a', 'Alpha beta gamma') }],
    ['search, 144 masks, 192 x 288, main-thread scorer, x1', [192, 288], undefined, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta gamma')]
  ]
  const report = {}
  for (const [name, size, worker, run] of cases) {
    natural = size
    vi.stubGlobal('Worker', worker)
    const times = { reference:[], candidate:[] }, busy = { reference:[], candidate:[] }, yielded = { reference:0, candidate:0 }
    for (let round = 0; round < 31; round++) for (const [side, module] of round % 2 ? [['candidate', candidate], ['reference', reference]] : [['reference', reference], ['candidate', candidate]]) {
      yields = 0
      const cpu = process.cpuUsage(), start = performance.now(); await run(module); const elapsed = performance.now() - start, used = process.cpuUsage(cpu)
      if (round) { times[side].push(elapsed); busy[side].push((used.user + used.system) / 1000); yielded[side] += yields }
    }
    report[name] = `wall js ${median(times.reference).toFixed(3)} ms, rust ${median(times.candidate).toFixed(3)} ms; cpu js ${median(busy.reference).toFixed(3)} ms, rust ${median(busy.candidate).toFixed(3)} ms; yields js ${yielded.reference}, rust ${yielded.candidate}`
  }
  console.log('COVER-APPEARANCE-BENCH ' + JSON.stringify(report, null, 1))
}, 600_000)
