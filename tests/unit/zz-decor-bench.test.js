import { it } from 'vitest'
import * as THREE from 'three'
import * as production from '../../src/js/shelf-trash.js'
import * as frozen from '../../src/js/zz-main-shelf-trash.js'
import { createShelfPlant } from '../../src/js/shelf-plants.js'
import { createShelfPlant as frozenPlant } from '../../src/js/zz-main-shelf-plants.js'
import { createBaggebo } from '../../src/js/baggebo-model.js'
import { createBaggebo as frozenBaggebo } from '../../src/js/zz-main-baggebo-model.js'
import './helpers/rust-shelf-ready.js'

const median = list => list.sort((a, b) => a - b)[list.length >> 1]
function time(run, rounds = 7) { const out = []; for (let r = 0; r < rounds; r++) { const t = performance.now(); run(); out.push(performance.now() - t) } return median(out) }

it('bench', () => {
  const lines = []
  for (const [name, make] of [['main', frozen.createShelfTrash], ['rust', production.createShelfTrash]]) {
    const bin = make(); bin.updateMatrixWorld(true)
    const ms = time(() => { for (let i = 0; i < 20000; i++) { bin.userData.setState({ openness:(i % 100) / 100, bounce:(i % 37) / 37 }); bin.userData.getMouth() } })
    lines.push(`trash setState+getMouth x20000 ${name}: ${ms.toFixed(2)} ms`)
    const build = time(() => { for (let i = 0; i < 20; i++) make().userData.dispose() }, 5)
    lines.push(`trash create x20 ${name}: ${build.toFixed(2)} ms`)
  }
  for (const [name, make] of [['main', frozenBaggebo], ['rust', createBaggebo]]) {
    make().userData.dispose()
    lines.push(`baggebo create x20 ${name}: ${time(() => { for (let i = 0; i < 20; i++) make().userData.dispose() }, 5).toFixed(2)} ms`)
  }
  const entry = seed => ({ kind:'plant', catalogId:'monstera', potId:'muskot', seed:`bench-${seed}`, height:120 })
  for (const [name, make] of [['main', frozenPlant], ['rust', createShelfPlant]]) {
    let n = 0
    lines.push(`plant create x20 ${name}: ${time(() => { for (let i = 0; i < 20; i++) make(entry(n++)).userData.dispose() }, 5).toFixed(2)} ms`)
  }
  console.log(lines.join('\n'))
})
