// Actual compiled kernel plus the exact production JS bridge/extraction body.
// The getter import alone is injected because bare Node cannot load ?url.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractPDFText as referencePDFText } from '../tests/unit/helpers/reference-pdf-text.js'
import { extractPDFText as referenceBeforeRows } from '../tests/unit/helpers/reference-before-pdf-rows.js'
import { legacyPDFRowLines } from '../tests/unit/helpers/reference-pdf-pipeline.js'
import { PDF_ROW_BENCH_CASES, makePDFRowEntries, pdfContentFromEntries, PDF_ROW_VIEWPORT,
  assertExactPDFValue, assertPDFRowIdentities, assertPDFSourceIdentities } from '../tests/helpers/pdf-row-cases.mjs'
const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url))
const started=performance.now(),{instance}=await WebAssembly.instantiate(bytes),compiled=instance.exports,initializationMs=performance.now()-started
assert.equal(typeof compiled.pdf_row_lines,'function')
let core=compiled,calls=0
const tracked={...compiled,pdf_row_lines(...args){calls++;return compiled.pdf_row_lines(...args)}}
globalThis.__benchmarkCore=()=>core
// The production modules themselves, with the one getter import (bare Node cannot load ?url) pointed at this core.
const directory=await mkdtemp(join(tmpdir(),'pdf-row-bench-'))
const modules=['pdf-text','pdf-row-layout-wasm','pdf-order-wasm','pdf-stream-wasm','core-required']
const sources=Object.fromEntries(await Promise.all(modules.map(async name=>[name,await read(`../src/js/readers/${name}.js`)])))
await writeFile(join(directory,'rust-core.js'),'export const getRustCore=()=>globalThis.__benchmarkCore()\n')
for(const name of modules)await writeFile(join(directory,`${name}.js`),sources[name].replaceAll("'../rust-core.js'","'./rust-core.js'"))
const {pdfRowLines:_rows,rustPDFRowLines}=await import(pathToFileURL(join(directory,'pdf-row-layout-wasm.js')))
const {extractPDFText:extract}=await import(pathToFileURL(join(directory,'pdf-text.js')))
const rows={rustPDFRowLines,legacyPDFRowLines}
const rowSource=sources['pdf-row-layout-wasm'],columnSource='',textSource=sources['pdf-text']
const beforeRowsSource=await read('../tests/unit/helpers/reference-before-pdf-rows.js')
const beforeRowsExtract=referenceBeforeRows
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
const observations=[]
for(const spec of PDF_ROW_BENCH_CASES) {
  const entries=makePDFRowEntries(spec.kind,spec.count),source=pdfContentFromEntries(entries),before=structuredClone(source)
  core=tracked
  assertPDFRowIdentities(rows.rustPDFRowLines(entries),rows.legacyPDFRowLines(entries,false))
  const actual=extract(source,PDF_ROW_VIEWPORT),expected=referencePDFText(source,PDF_ROW_VIEWPORT)
  assertExactPDFValue(actual,expected);assertExactPDFValue(actual,beforeRowsExtract(source,PDF_ROW_VIEWPORT));assertPDFSourceIdentities(actual,source);assertExactPDFValue(source,before)
  assert.ok(calls>0);core=compiled
  const runs={rowsJS:()=>rows.legacyPDFRowLines(entries,false),rowsRust:()=>rows.rustPDFRowLines(entries),
    extractionJS:()=>referencePDFText(source,PDF_ROW_VIEWPORT),extractionBeforeRows:()=>beforeRowsExtract(source,PDF_ROW_VIEWPORT),extractionProduction:()=>extract(source,PDF_ROW_VIEWPORT)}
  const repetitions=spec.count<=32?16:spec.count<=128?4:1, samples=Object.fromEntries(Object.keys(runs).map(key=>[key,[]])),orders=[]
  for(let warm=0;warm<2;warm++)for(const run of Object.values(runs))for(let i=0;i<repetitions;i++)run()
  for(let round=0;round<9;round++) {
    const order=round%2?Object.keys(runs).reverse():Object.keys(runs);orders.push(order)
    for(const name of order){const start=performance.now();for(let i=0;i<repetitions;i++)runs[name]();samples[name].push((performance.now()-start)/repetitions)}
  }
  observations.push({spec,repetitions,orders,samples,medians:Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,median(values)])),
    exactParity:true,inputPreserved:true,lines:actual.lines.length,paragraphs:actual.paragraphs.length,textUTF16Length:actual.text.length})
}
for(let sample=0;sample<150;sample++) {
  const entries=makePDFRowEntries('mixed',1+(sample*31)%337,0x67aa2511+sample*17),source=pdfContentFromEntries(entries)
  assertPDFRowIdentities(rows.rustPDFRowLines(entries),rows.legacyPDFRowLines(entries,false))
  const actual=extract(source,PDF_ROW_VIEWPORT)
  assertExactPDFValue(actual,referencePDFText(source,PDF_ROW_VIEWPORT));assertExactPDFValue(actual,beforeRowsExtract(source,PDF_ROW_VIEWPORT));assertPDFSourceIdentities(actual,source)
}
const report={generatedAt:new Date().toISOString(),scope:'Desktop Node. Actual WASM, full bridge copies/validation/reconstruction and complete extraction. Getter imports injected; no numeric implementation mocked. No physical-phone or GPU claim.',
  environment:{node:process.version,cpu:cpus()[0]?.model,platform:process.platform},artifact:{bytes:bytes.length,sha256:hash(bytes)},
  sourceHashes:{rows:hash(rowSource),pdfText:hash(textSource),beforeRowsPDFText:hash(beforeRowsSource)},initializationMs,
  proofKernelCalls:calls,fuzzCases:150,methodology:{warmups:2,rounds:9,alternating:true,timingAssertions:false},wasmCapacityBytes:compiled.memory.buffer.byteLength,observations}
await rm(directory,{recursive:true,force:true})
const json=JSON.stringify(report,null,2)+'\n'
if(process.argv[2])await writeFile(process.argv[2],json,{flag:'wx'})
process.stdout.write(json)
