// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadRustCore } from '../../src/js/rust-core.js'
import { createRustFontScorer } from '../../src/js/font-score-wasm.js'
import { glyphMask, nearEdgeMap, scoreFontMask as originalScore } from './helpers/reference-cover-appearance.js'

const drain=task=>{let step=task.next();while(!step.done)step=task.next();return step.value}
let core
beforeAll(async()=>{
  core=await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))})
  expect(core).not.toBeNull()
  expect(typeof core.font_score).toBe('function')
})
function fixture(width,height,seed) {
  let state=seed+1
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
  const gray=Uint8Array.from({length:width*height},()=>Math.floor(random()*256))
  const near=nearEdgeMap(Float32Array.from({length:gray.length},()=>random()*255),width)
  const raw=new Uint8ClampedArray(30*22*4)
  for(let y=2;y<20;y++)for(let x=2;x<28;x++)if(x<8||y<8||((x+2*y+seed)%7===0))raw[(y*30+x)*4+3]=255
  return {gray,near,width,height,rows:Math.floor(height*.82),mask:glyphMask(raw,30,22,width)}
}
const expected=({gray,near,width,height,rows,mask})=>drain(originalScore(gray,near,width,height,rows,mask))

describe('compiled Rust title-font scorer',()=>{
  for(const [width,height] of [[64,80],[192,128],[192,288]]) {
    it(`matches every f64 result of the original matcher at ${width}x${height}`,()=>{
      for(const seed of [0,1,7,17,43,255]) {
        const input=fixture(width,height,seed),scorer=createRustFontScorer(core,input)
        try { expect(scorer.score(input.mask)).toBe(expected(input)) }
        finally { scorer.dispose() }
      }
    })
  }
  it('preserves tie, flat image and NaN edge decisions',()=>{
    const input=fixture(64,80,1)
    for(const fill of [0,127,128,255]) {
      input.gray.fill(fill);input.near.fill(fill)
      input.near.fill(NaN,0,input.width);input.near.fill(NaN,input.near.length-input.width)
      const scorer=createRustFontScorer(core,input)
      try { expect(scorer.score(input.mask)).toBe(expected(input)) }
      finally { scorer.dispose() }
    }
    input.near.fill(NaN)
    const scorer=createRustFontScorer(core,input)
    try { expect(scorer.score(input.mask)).toBe(expected(input)) }
    finally { scorer.dispose() }
  })
  it('keeps an independent uploaded image while scoring fresh masks and growing memory',()=>{
    const input=fixture(64,80,17),reference=expected(input),scorer=createRustFontScorer(core,input)
    try {
      input.gray.fill(0);input.near.fill(0)
      expect(scorer.score(input.mask)).toBe(reference)
      core.memory.grow(1)
      expect(scorer.score(input.mask)).toBe(reference)
    } finally { scorer.dispose() }
    expect(()=>scorer.score(input.mask)).toThrow('Inactive font score job')
    expect(()=>scorer.dispose()).not.toThrow()
  })
  it('releases each mask arena and the one image arena without retaining per-mask pixels',()=>{
    const allocations=[],releases=[]
    const tracked={...core,
      alloc_f64(length){const pointer=core.alloc_f64(length);allocations.push([pointer,length]);return pointer},
      free_f64(pointer,length){releases.push([pointer,length]);core.free_f64(pointer,length)}
    }
    const input=fixture(64,80,1),scorer=createRustFontScorer(tracked,input)
    expect(allocations).toHaveLength(1)
    for(let i=0;i<4;i++)expect(scorer.score(input.mask)).toBe(expected(input))
    expect(allocations).toHaveLength(5);expect(releases).toHaveLength(4)
    expect(releases).toEqual(allocations.slice(1))
    scorer.dispose();scorer.dispose()
    expect(releases).toHaveLength(5);expect(releases[4]).toEqual(allocations[0])
  })
  it('rejects malformed inputs before accessing wasm memory and can still score after an invalid mask',()=>{
    const input=fixture(64,80,1)
    expect(()=>createRustFontScorer(core,{...input,near:new Float32Array(1)})).toThrow('Invalid font score image')
    const scorer=createRustFontScorer(core,input)
    try {
      expect(()=>scorer.score({...input.mask,mask:new Uint8Array(1)})).toThrow('Invalid font score mask')
      expect(()=>scorer.score({...input.mask,width:1.5})).toThrow('Invalid font score mask')
      expect(scorer.score(input.mask)).toBe(expected(input))
    } finally { scorer.dispose() }
  })
})


describe('interruptible Rust scoring',()=>{
  it('preserves every score with different step budgets and memory growth between steps',()=>{
    for(const budget of [1,2,7,31,0xffffffff])for(const seed of [0,13,255]) {
      const input=fixture(192,288,seed),scorer=createRustFontScorer(core,input),task=scorer.steps(input.mask,budget)
      let step=task.next(),count=0
      while(!step.done){if(count++===2)core.memory.grow(1);step=task.next()}
      expect(step.value).toBe(expected(input));scorer.dispose()
    }
  })
  it('frees suspended mask and image exactly once when cancelled',()=>{
    const input=fixture(192,288,9);let bytes=0
    const tracked={...core,alloc_f64(n){bytes+=n*8;return core.alloc_f64(n)},free_f64(p,n){bytes-=n*8;core.free_f64(p,n)}}
    const scorer=createRustFontScorer(tracked,input),task=scorer.steps(input.mask)
    expect(task.next().done).toBe(false);expect(bytes).toBeGreaterThan(0)
    task.return();scorer.dispose();scorer.dispose();expect(bytes).toBe(0)
  })
})
