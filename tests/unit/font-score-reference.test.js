import { describe, expect, it } from 'vitest'
import { scoreFontMask } from '../../src/js/font-score-core.js'
import { glyphMask, nearEdgeMap, scoreFontMask as originalScore } from './helpers/reference-cover-appearance.js'
const drain=task=>{let step=task.next();while(!step.done)step=task.next();return step.value}

describe('extracted font score is the original numerical algorithm',()=>{
  for(const [width,height] of [[64,80],[192,128],[192,288]]) {
    it(`preserves exact bright/dark and edge scores at ${width}x${height}`,()=>{
      const raw=new Uint8ClampedArray(30*22*4)
      for(let y=2;y<20;y++)for(let x=2;x<28;x++)if(x<8||y<8||((x+2*y)%7===0))raw[(y*30+x)*4+3]=255
      const mask=glyphMask(raw,30,22,width);expect(mask).not.toBeNull()
      for(const seed of [0,1,17,255]) {
        const gray=Uint8Array.from({length:width*height},(_,i)=>(i*37+seed)%256)
        const near=nearEdgeMap(Float32Array.from({length:gray.length},(_,i)=>(i*13+seed)%255),width)
        const args=[gray,near,width,height,Math.floor(height*.82),mask]
        expect(drain(scoreFontMask(...args))).toBe(drain(originalScore(...args)))
      }
    })
  }
})
