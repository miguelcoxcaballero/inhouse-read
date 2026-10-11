import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const runtime = vi.hoisted(() => ({ core:null }))
vi.mock('../../src/js/rust-core.js', () => ({ getRustCore:() => runtime.core }))
import { rustPDFRowLines, legacyPDFRowLines, pdfRowLines, PDF_ROW_MIN_ITEMS } from '../../src/js/readers/pdf-row-layout-wasm.js'
import { extractPDFText, mapPDFTextLayer } from '../../src/js/readers/pdf-text.js'
import { extractPDFText as referencePDFText } from './helpers/reference-pdf-text.js'
import { makePDFRowEntries, pdfContentFromEntries, PDF_ROW_VIEWPORT, assertExactPDFValue,
  assertPDFRowIdentities, assertPDFSourceIdentities } from '../helpers/pdf-row-cases.mjs'

let compiled
beforeAll(async()=>{
  const {instance}=await WebAssembly.instantiate(readFileSync(resolve('src/wasm/inhouse_read_core.wasm')), {})
  compiled=runtime.core=instance.exports
  expect(compiled.pdf_row_lines).toBeTypeOf('function')
})
afterEach(()=>{ runtime.core=compiled })
function parity(entries) {
  const before=structuredClone(entries),expected=legacyPDFRowLines(entries,false),actual=rustPDFRowLines(entries)
  expect(actual).not.toBeUndefined()
  assertPDFRowIdentities(actual,expected);assertExactPDFValue(entries,before)
  return actual
}
const entry=(str,x0,y,height=12,width=20,rawIndex=0,dir='ltr')=>({
  item:{str,dir,metadata:{preserve:true}},rawIndex,x0,x1:x0+width,y,height,top:y-height,bottom:y
})

describe('actual Rust PDF row grouping and gutter segmentation',()=>{
  it('preserves full batches, source references and all row fields over varied fragmentation',()=>{
    for(const count of [0,1,4,32,128,512,1280]) for(const kind of ['paragraphs','fragmented','columns','mixed'])
      parity(makePDFRowEntries(kind,count))
  })
  it('matches a deterministic fuzz corpus with shuffled source order, mixed weights and directions',()=>{
    for(let sample=0;sample<100;sample++) parity(makePDFRowEntries('mixed',1+(sample*37)%241,0x1f124bb5+sample*101))
  })
  it('keeps weighted medians for superscripts and drop caps rather than averaging baselines',()=>{
    parity([entry('continues',40,118,12,90,0),entry('1',151,94,7,4,1),
      entry('Main text ',40,100,12,106,2),entry(' with note',159,100,12,100,3)])
    parity([entry('L',40,100,36,20,0),entry('a history begins',60,100,12,200,1),entry('next line',60,118,12,200,2)])
  })
  it('retains strict grouping and gutter threshold neighbors without f32 rounding',()=>{
    for(const epsilon of [-1e-10,0,1e-10]) for(const height of [1,7.125,12,18.5]) {
      const dy=height*.42+epsilon
      parity([entry('main',0,30,height,10,0),entry('mark',12,30+dy,height,10,1)])
      const overlap=height*.65+epsilon
      const shifted=entry('second',12,30+height-overlap,height,10,1)
      parity([entry('first',0,30,height,10,0),shifted])
      parity([entry('left',0,30,height,10,0),entry('right',10+height*2+epsilon,30,height,10,1)])
    }
  })
  it('retains reverse candidate tie choice, stable sort ties and signed zero',()=>{
    parity([entry('a',0,0,1,1,0),entry('b',0,-0,1,1,0),entry('c',0,0,1,1,0)])
    parity([entry('first',0,10,1,10,0),entry('second',20,12,1,10,1),entry('center',40,11,5,10,2)])
    const zero=entry('zero',-0,-0,1,0,0); zero.x1=-0
    parity([zero])
  })
  it('uses JavaScript UTF-16 and trim weights for emoji, combining marks, Unicode spaces and RTL ties',()=>{
    parity([entry('👩🏽‍💻',0,20,12,10,0,'rtl'),entry('abcdefg',12,20,12,10,1,'ltr')])
    parity([entry('\u00a0',0,20,7,8,0),entry('𠮷',10,21,12,12,1),entry('e\u0301',25,21,12,12,2)])
    parity([entry('עברית',0,20,12,40,0,'rtl'),entry('English',42,20,12,42,1),entry(' العربية ',86,20,12,55,2,'rtl')])
  })
  it('keeps entire extraction, paragraphs, source metadata and UTF-16 spans exact',()=>{
    let calls=0
    runtime.core={...compiled,pdf_row_lines(...args){calls++;return compiled.pdf_row_lines(...args)}}
    for(const kind of ['fragmented','columns','mixed']) {
      const content=pdfContentFromEntries(makePDFRowEntries(kind,256)),before=structuredClone(content)
      const expected=referencePDFText(content,PDF_ROW_VIEWPORT),actual=extractPDFText(content,PDF_ROW_VIEWPORT)
      assertExactPDFValue(actual,expected);assertExactPDFValue(content,before);assertPDFSourceIdentities(actual,content)
      const layer=document.createElement('div')
      for(const item of actual.items) {const span=document.createElement('span');span.textContent=item.str;layer.append(span)}
      const mapped=mapPDFTextLayer(layer,actual)
      expect(mapped).not.toBeNull();expect(mapped.text).toBe(actual.text)
      for(const span of actual.spans) expect(mapped.rangeFor(span.start,span.end)?.toString()).toBe(actual.text.slice(span.start,span.end))
    }
    expect(calls).toBe(3)
  })
  it('retains whole rotated-page and unsupported vertical/mixed-angle fallbacks',()=>{
    const content=pdfContentFromEntries(makePDFRowEntries('mixed',256))
    for(const degrees of [90,180,270]) {
      const angle=degrees*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle)
      const view={transform:[cos,sin,sin,-cos,0,0]}
      assertExactPDFValue(extractPDFText(content,view),referencePDFText(content,view))
    }
    for(const alter of [item=>{item.dir='ttb'},item=>{item.transform=null},item=>{item.transform=[0,12,-12,0,50,50]}]) {
      const source=structuredClone(content);alter(source.items[0])
      assertExactPDFValue(extractPDFText(source,PDF_ROW_VIEWPORT),referencePDFText(source,PDF_ROW_VIEWPORT))
    }
  })
  it('runs one ABI call for a complete eligible page and none for the small-page fallback',()=>{
    let calls=0
    runtime.core={...compiled,pdf_row_lines(...args){calls++;return compiled.pdf_row_lines(...args)}}
    const small=makePDFRowEntries('mixed',PDF_ROW_MIN_ITEMS-1)
    assertPDFRowIdentities(pdfRowLines(small,false),legacyPDFRowLines(small,false));expect(calls).toBe(0)
    const large=makePDFRowEntries('mixed',PDF_ROW_MIN_ITEMS)
    assertPDFRowIdentities(pdfRowLines(large,false),legacyPDFRowLines(large,false));expect(calls).toBe(1)
  })
  it('reacquires output views after kernel memory growth and owns its resulting objects',()=>{
    runtime.core={...compiled,pdf_row_lines(...args){compiled.memory.grow(1);return compiled.pdf_row_lines(...args)}}
    const entries=makePDFRowEntries('mixed',128),result=parity(entries),before=structuredClone(result)
    compiled.memory.grow(1);assertExactPDFValue(result,before)
    parity(makePDFRowEntries('columns',256))
  })
  it('keeps original behavior when unavailable, over the bound or given unsupported numeric records',()=>{
    const entries=makePDFRowEntries('mixed',128)
    runtime.core=null;expect(rustPDFRowLines(entries)).toBeUndefined()
    assertPDFRowIdentities(pdfRowLines(entries,false),legacyPDFRowLines(entries,false))
    runtime.core=compiled
    for(const mutate of [row=>{row.y=NaN},row=>{row.height=Infinity},row=>{row.rawIndex=-1},row=>{row.x1=row.x0-1}]) {
      const unsupported=structuredClone(entries);mutate(unsupported[0]);expect(rustPDFRowLines(unsupported)).toBeUndefined()
    }
    expect(rustPDFRowLines({length:32769})).toBeUndefined()
  })
  it('discards a failed arena and falls back after rejection, trap or corrupt output metadata',()=>{
    const entries=makePDFRowEntries('mixed',128),expected=legacyPDFRowLines(entries,false)
    for(const failure of ['reject','trap','duplicate','nonfinite']) {
      let releases=0
      runtime.core={...compiled,free_f64(...args){releases++;compiled.free_f64(...args)},pdf_row_lines(...args){
        if(failure==='reject')return 0
        if(failure==='trap')throw new WebAssembly.RuntimeError('test trap')
        const result=compiled.pdf_row_lines(...args)
        if(failure==='duplicate')new Float64Array(compiled.memory.buffer,args[2],args[1]).fill(0)
        if(failure==='nonfinite')new Float64Array(compiled.memory.buffer,args[3],result*9)[2]=NaN
        return result
      }}
      assertPDFRowIdentities(pdfRowLines(entries,false),expected);expect(releases).toBe(1)
    }
    runtime.core=compiled;parity(entries)
  })
})
