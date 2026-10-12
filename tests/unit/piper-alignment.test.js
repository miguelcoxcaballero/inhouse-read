// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {exposePiperDurations,phonemeMarks,durationMarks} from '../../src/js/readers/neural-voice/piper-alignment.js'
const encode=new TextEncoder()
const field=(n,bytes)=>[n*8+2,bytes.length,...bytes]
const str=(n,s)=>field(n,encode.encode(s))
const node=(op,input,output)=>field(1,[...str(1,input),...str(2,output),...str(4,op)])
const model=()=>Uint8Array.from(field(7,[...node('Ceil','a','b'),...node('CumSum','b','c'),
  ...['input','input_lengths','scales'].flatMap(n=>field(11,str(1,n))),...field(12,str(1,'audio'))]))
describe('Piper durations without modifying acoustic weights',()=>{
  it('only adds an output to the existing unique duration tensor, preserving all graph fields',()=>{
    const input=model(),before=input.slice(),result=exposePiperDurations(input)
    expect(result.name).toBe('b');expect(input).toEqual(before)
    expect(result.bytes.length-input.length).toBeLessThan(80)
    expect(Buffer.from(result.bytes).includes(Buffer.from(input.subarray(2)))).toBe(true)
    const again=exposePiperDurations(result.bytes)
    expect(again.bytes).toBe(result.bytes);expect(again.name).toBe('b')
  })
  it.each([[],[255],[58,127],[58,4,8,255,255,255],[0,0]].map(value=>[value]))('leaves malformed/unknown graphs untouched: %j',value=>{
    const input=Uint8Array.from(value),result=exposePiperDurations(input)
    expect(result.bytes).toBe(input);expect(result.name).toBeNull()
  })
  it('maps requested UTF-16 boundaries through prefix phonemes, never resynthesizing a prefix',async()=>{
    const calls=[]
    const result=await phonemeMarks('One two.',[4,4,-1,200], [1,0,9,0,10,0,11,0,2],async text=>{calls.push(text);return [1,0,9,0,2]})
    expect(calls).toEqual(['One ']);expect(result).toEqual([{offset:4,phoneme:4}])
  })
  it('uses actual phoneme frame durations with exact silence-trim and leading-rest offsets',()=>{
    const marks=[{offset:5,phoneme:3},{offset:11,phoneme:7}]
    const result=durationMarks(marks,Float32Array.of(2,3,1,4),{base:1,count:4,samples:2560,trim:100,lead:20,length:2480})
    expect(result).toEqual([{offset:5,sample:1200}])
    expect(durationMarks(marks,[NaN],{count:1})).toEqual([])
  })
})
