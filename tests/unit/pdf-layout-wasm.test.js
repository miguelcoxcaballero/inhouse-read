import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const runtime = vi.hoisted(() => ({ core:null }))
vi.mock('../../src/js/rust-core.js', () => ({ getRustCore:() => runtime.core }))
import { legacyPDFColumnCut, rustPDFColumnCut, pdfColumnCut } from '../../src/js/readers/pdf-layout-wasm.js'
import { extractPDFText } from '../../src/js/readers/pdf-text.js'

let compiled
beforeAll(async () => {
  const { instance } = await WebAssembly.instantiate(readFileSync(resolve('src/wasm/inhouse_read_core.wasm')), {})
  compiled = runtime.core = instance.exports
  expect(compiled.pdf_column_cut).toBeTypeOf('function')
})
afterEach(() => { runtime.core = compiled })

const line = (x0, x1, y, height = 12) => ({ x0,x1,y,height,top:y-height,bottom:y })
const column = (x0, x1, rows = 8, shift = 0) => Array.from({ length:rows }, (_, index) => line(x0,x1,40 + index * 18 + shift))
function assertParity(lines) {
  const before = structuredClone(lines), expected = legacyPDFColumnCut(lines)
  const actual = rustPDFColumnCut(lines)
  expect(actual).not.toBeUndefined()
  expect(actual).toEqual(expected)
  expect(lines).toEqual(before)
  if (expected?.left) for (const side of ['left','right','crossing']) {
    expect(actual[side]).toHaveLength(expected[side].length)
    actual[side].forEach((value, index) => expect(value).toBe(expected[side][index]))
  }
  return actual
}

describe('compiled Rust PDF gutter detection retains the original geometry contract', () => {
  it('preserves actual cut, table and no-cut outcomes and source line identities', () => {
    expect(assertParity([...column(20,250),...column(290,520)])?.at).toBe(270)
    expect(assertParity([...column(20,70),...column(120,170)])).toEqual({ table:true })
    expect(assertParity(column(20,520))).toBeNull()
    expect(assertParity([])).toBeNull()
    expect(assertParity(column(20,250,3))).toBeNull()
  })

  it('keeps full-width headings and figures crossing two and three columns', () => {
    const columns = [...column(20,160),...column(190,330),...column(360,500)]
    const result = assertParity([line(10,540,16,16),...columns,line(0,550,112,24),line(5,535,220,18)])
    expect(result?.crossing).toHaveLength(3)
  })

  it('keeps the first candidate when distinct gutters have equal scores', () => {
    const left = [50,100,150,200].map(y=>line(20,150,y))
    const middle = [50,100].map(y=>line(170,300,y))
    const right = [150,200].map(y=>line(380,510,y))
    const result = assertParity([...left,...middle,...right])
    expect(result?.at).toBe(160)
    expect(result?.score).toBe(320)
  })

  it('retains threshold decisions with fractional geometry and nearby floating point values', () => {
    for (const epsilon of [-1e-10,0,1e-10]) for (const height of [1,7.125,12,18.5]) {
      const gap = height * .65 + epsilon
      for (const displacement of [height * .25 + epsilon,height * 1.6 + epsilon]) {
        const rows = [0,1,2,3].map(index => line(-0,120,30+index*height*1.5,height))
        const shifted = [0,1,2,3].map(index => line(120+gap,260+gap,30+index*height*1.5+displacement,height))
        assertParity([...rows,...shifted])
      }
    }
  })

  it('matches deterministic mixed layouts with shuffled source order, duplicate edges and varied leading', () => {
    let seed = 0x52454144
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296 }
    for (let sample=0; sample<180; sample++) {
      const columns = 1+Math.floor(random()*4), rows = 3+Math.floor(random()*13), lines = []
      for (let col=0;col<columns;col++) for (let row=0;row<rows;row++) {
        const height = 9+Math.floor(random()*7), x0 = 20+col*180+(random()<.25?random()*5:0)
        const width = random()<.2?35:105+random()*40
        lines.push(line(x0,x0+width,30+row*20+(random()-.5)*3,height))
      }
      if (sample%3===0) lines.push(line(0,columns*180,10,18))
      if (sample%5===0) lines.push(line(0,columns*180,rows*10,16))
      for (let index=lines.length-1;index>0;index--) {
        const to = Math.floor(random()*(index+1)); [lines[index],lines[to]]=[lines[to],lines[index]]
      }
      assertParity(lines)
    }
  })

  it('falls back before the module is ready or when geometry cannot cross the finite ABI', () => {
    const lines = [...column(20,250),...column(290,520)]
    runtime.core = null
    expect(rustPDFColumnCut(lines)).toBeUndefined()
    expect(pdfColumnCut(lines)).toEqual(legacyPDFColumnCut(lines))
    runtime.core = compiled
    for (const invalid of [NaN,Infinity,-Infinity,'20']) {
      const altered = lines.map((entry,index) => index?entry:{ ...entry,x0:invalid })
      expect(rustPDFColumnCut(altered)).toBeUndefined()
      expect(pdfColumnCut(altered)).toEqual(legacyPDFColumnCut(altered))
    }
  })

  it('frees its input when a runtime failure selects the original fallback', () => {
    const lines = [...column(20,250),...column(290,520)]
    const free = vi.fn(compiled.free_f64)
    runtime.core = { ...compiled,free_f64:free,pdf_column_cut:() => { throw new Error('interrupted module') } }
    expect(pdfColumnCut(lines)).toEqual(legacyPDFColumnCut(lines))
    expect(free).toHaveBeenCalledOnce()
  })

  it('rejects shared horizontal interiors exactly before allocating or copying geometry', () => {
    const allocate = vi.fn(compiled.alloc_f64), kernel = vi.fn(compiled.pdf_column_cut)
    runtime.core = { ...compiled,alloc_f64:allocate,pdf_column_cut:kernel }
    for (const count of [4,12,80,240,1280]) {
      const lines = column(20,520,count).map((entry,index)=>({ ...entry,x0:20+(index%3)*8,x1:520-(index%4)*7 }))
      expect(legacyPDFColumnCut(lines)).toBeNull()
      expect(pdfColumnCut(lines)).toBeNull()
    }
    expect(allocate).not.toHaveBeenCalled()
    expect(kernel).not.toHaveBeenCalled()
  })

  it('reuses a bounded arena for successive page splits while preserving complete output', () => {
    const allocate = vi.fn(compiled.alloc_f64), free = vi.fn(compiled.free_f64)
    runtime.core = { ...compiled,alloc_f64:allocate,free_f64:free }
    const lines = [...column(20,250,80),...column(290,520,80)]
    for (let attempt=0;attempt<4;attempt++) assertParity(lines)
    expect(allocate).toHaveBeenCalledOnce()
    expect(allocate.mock.calls[0][0]).toBeLessThanOrEqual(8192)
    expect(free).not.toHaveBeenCalled()
    // A different realm/core must never read another instance's arena.
    runtime.core = compiled
    assertParity(lines)
    expect(free).toHaveBeenCalledOnce()
  })

  it('does not retain oversized page arenas in the mobile high-water cache', () => {
    const allocate = vi.fn(compiled.alloc_f64), free = vi.fn(compiled.free_f64)
    runtime.core = { ...compiled,alloc_f64:allocate,free_f64:free }
    const lines = [...column(20,250,700),...column(290,520,700)]
    assertParity(lines)
    const allocatedLength = allocate.mock.calls.at(-1)[0]
    expect(allocatedLength).toBe(lines.length*6+3)
    expect(free).toHaveBeenCalledWith(expect.any(Number),allocatedLength)
  })

  it('keeps nested numeric calls in separate arenas and refreshes views after memory growth', () => {
    const outer = [...column(20,250,8),...column(290,520,8)]
    const nested = [...column(50,210,6),...column(260,430,6)]
    let entered = false, nestedResult
    runtime.core = { ...compiled,pdf_column_cut:(...args) => {
      if (!entered) {
        entered = true
        nestedResult = rustPDFColumnCut(nested)
        // Grow through the real allocator while the outer lease is still live.
        const scratch = compiled.alloc_f64(200_000)
        compiled.free_f64(scratch,200_000)
      }
      return compiled.pdf_column_cut(...args)
    } }
    expect(rustPDFColumnCut(outer)).toEqual(legacyPDFColumnCut(outer))
    expect(nestedResult).toEqual(legacyPDFColumnCut(nested))
  })

  it('preserves complete multilingual extraction and UTF-16 source offsets after integration', () => {
    const item = (str,x,y,dir='ltr') => ({ str,dir,width:145,height:12,transform:[12,0,0,12,x,800-y],hasEOL:true,fontName:'source-font' })
    const inputs = [
      [item('Heading 😀.',20,20),...Array.from({length:8},(_,index)=>[
        item(`Left ${index} café 👩🏽‍💻.`,20,50+index*18),item(`Right ${index} 日本語。`,220,50+index*18)
      ]).flat()],
      Array.from({length:8},(_,index)=>[
        item(`يمين ${index}.`,220,50+index*18,'rtl'),item(`يسار ${index}.`,20,50+index*18,'rtl')
      ]).flat()
    ]
    const view = { transform:[1,0,0,-1,0,800] }
    for (const items of inputs) {
      const source = { items:items.slice().reverse() }, original = structuredClone(source)
      runtime.core = null
      const expected = extractPDFText(source,view)
      runtime.core = compiled
      const actual = extractPDFText(source,view)
      expect(actual).toEqual(expected)
      expect(source).toEqual(original)
      expect(actual.geometric).toBe(true)
      expect(new Set(actual.spans.map(span=>span.rawIndex)).size).toBe(items.length)
      for (const row of actual.lines) for (const entry of row.entries) expect(entry.item).toBe(source.items[entry.rawIndex])
    }
  })
})
