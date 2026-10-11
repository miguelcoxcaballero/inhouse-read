// Arithmetic benchmark only: desktop Node, no browser/GPU/phone speed claim.
// Usage: node scripts/benchmark-rust-core.mjs [output.json]
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { glyphMask, nearEdgeMap, scoreFontMask } from '../tests/unit/helpers/reference-cover-appearance.js';
import { createRustFontScorer } from '../src/js/font-score-wasm.js';

const WIDTH=192, HEIGHT=288, ROWS=Math.floor(HEIGHT*.82), WARMUPS=5, BATCHES=15;
const GLYPHS={
  I:['11111','00100','00100','00100','00100','00100','11111'],
  N:['10001','11001','11001','10101','10011','10011','10001'],
  H:['10001','10001','10001','11111','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  A:['01110','10001','10001','11111','10001','10001','10001'],
  D:['11110','10001','10001','10001','10001','10001','11110']
};

// Two title lines, four real production search sizes, three alignments and
// two letter heights form 24 different representative binary glyph rasters.
// Canvas/font loading is deliberately outside this numeric-kernel benchmark.
function candidateMasks() {
  const masks=[];
  for(const size of [11,16,22,29])for(const align of ['left','center','right'])for(const upper of [false,true]) {
    const charWidth=Math.max(4,Math.round(size*.55)),charHeight=Math.max(7,Math.round(size*(upper?1:.78)));
    const rasterHeight=Math.ceil(size*3),raw=new Uint8ClampedArray(WIDTH*rasterHeight*4);
    for(const [line,text] of ['INHOUSE','READ'].entries()) {
      const textWidth=text.length*charWidth,baseX=align==='left'?4:align==='right'?WIDTH-4-textWidth:Math.floor((WIDTH-textWidth)/2);
      const baseY=3+line*Math.ceil(size*1.3);
      for(let letter=0;letter<text.length;letter++)for(let y=0;y<charHeight;y++)for(let x=0;x<charWidth-1;x++) {
        if(GLYPHS[text[letter]][Math.floor(y*7/charHeight)][Math.floor(x*5/(charWidth-1))]==='1') {
          raw[((baseY+y)*WIDTH+baseX+letter*charWidth+x)*4+3]=255;
        }
      }
    }
    const mask=glyphMask(raw,WIDTH,rasterHeight,WIDTH);
    assert.ok(mask,'Synthetic title must produce a valid production glyph mask');
    masks.push({label:`${size}/${align}/${upper?'capitals':'short-letters'}`,mask});
  }
  assert.equal(masks.length,24);
  return masks;
}

function image(seed) {
  let state=seed;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
  const gray=Uint8Array.from({length:WIDTH*HEIGHT},()=>Math.floor(random()*256)),edges=new Float32Array(gray.length);
  for(let y=1;y<HEIGHT-1;y++)for(let x=1;x<WIDTH-1;x++) {
    const at=y*WIDTH+x;
    edges[at]=Math.min(255,Math.abs(gray[at+1]-gray[at-1])+Math.abs(gray[at+WIDTH]-gray[at-WIDTH]));
  }
  return {seed,gray,near:nearEdgeMap(edges,WIDTH),width:WIDTH,height:HEIGHT,rows:ROWS};
}
const drain=task=>{let step;do {step=task.next()}while(!step.done);return step.value};
const masks=candidateMasks(),images=[1,17,43].map(image);
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const initializedAt=performance.now();
const {instance}=await WebAssembly.instantiate(bytes);
const initializeMs=performance.now()-initializedAt,core=instance.exports;
assert.equal(core.core_abi_version(),1);
assert.equal(typeof core.font_score,'function');
const initialMemoryBytes=core.memory.buffer.byteLength;
const firstUploadStart=performance.now();
const firstScorer=createRustFontScorer(core,images[0]);
const firstImageUploadMs=performance.now()-firstUploadStart;
firstScorer.dispose();

function jsBatch() {
  const scores=[];
  for(const context of images)for(const {mask} of masks) {
    scores.push(drain(scoreFontMask(context.gray,context.near,WIDTH,HEIGHT,ROWS,mask)));
  }
  return scores;
}
function rustBatch() {
  const scores=[];
  for(const context of images) {
    const scorer=createRustFontScorer(core,context);
    try {for(const {mask} of masks)scores.push(scorer.score(mask))}
    finally {scorer.dispose()}
  }
  return scores;
}
function timed(task) {const start=performance.now();const value=task();return {ms:performance.now()-start,value}}
function statistics(samples) {
  const sorted=[...samples].sort((a,b)=>a-b);
  return {samples,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],totalMs:samples.reduce((a,b)=>a+b,0)};
}

// Fail numerical drift before starting any timed batch. Each timed result is
// also checked outside its clock, so speed can never conceal output changes.
const expected=jsBatch();
assert.deepEqual(rustBatch(),expected);
for(let i=0;i<WARMUPS;i++) {assert.deepEqual(jsBatch(),expected);assert.deepEqual(rustBatch(),expected)}
const afterWarmupMemoryBytes=core.memory.buffer.byteLength;
const js=[],rust=[],orders=[];
for(let batch=0;batch<BATCHES;batch++) {
  const order=batch%2?['rust','javascript']:['javascript','rust'];
  orders.push(order);
  for(const engine of order) {
    const result=timed(engine==='rust'?rustBatch:jsBatch);
    assert.deepEqual(result.value,expected);
    (engine==='rust'?rust:js).push(result.ms);
  }
}

// Measure retained arenas separately from timing. This delegates every real
// allocation and computation to the same exports, without mocking the kernel.
let liveBytes=0,peakBytes=0,allocationCount=0;
const instrumented={...core,
  alloc_f64(length){const pointer=core.alloc_f64(length);if(pointer){liveBytes+=length*8;peakBytes=Math.max(peakBytes,liveBytes);allocationCount++}return pointer},
  free_f64(pointer,length){core.free_f64(pointer,length);liveBytes-=length*8}
};
const retained=createRustFontScorer(instrumented,images[0]);
const retainedImageBytes=liveBytes;
for(const {mask}of masks)retained.score(mask);
const retainedAfter24MasksBytes=liveBytes;
retained.dispose();
assert.equal(liveBytes,0);
assert.equal(retainedImageBytes,retainedAfter24MasksBytes);
const uploadSamples=[];
for(let i=0;i<BATCHES;i++) {
  const start=performance.now(),scorer=createRustFontScorer(core,images[i%images.length]);
  uploadSamples.push(performance.now()-start);scorer.dispose();
}
const report={
  benchmark:'font-score-rust-vs-original',generatedAt:new Date().toISOString(),
  environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},
  scope:'Desktop Node arithmetic benchmark. Synthetic seeded images and glyph masks; excludes browser startup, network, canvas, worker messaging and GPU. Does not establish Android or whole-app speed.',
  methodology:{dimensions:[WIDTH,HEIGHT],rows:ROWS,seeds:images.map(item=>item.seed),candidatesPerImage:masks.length,scoresPerBatch:expected.length,warmupBatchesPerEngine:WARMUPS,measuredBatchesPerEngine:BATCHES,orders,includes:'Rust timing includes one image upload/free per image and allocation, copy and free for every mask. JavaScript timing drains the original generator.',maskLabels:masks.map(item=>item.label)},
  artifact:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},
  exactParity:{verified:true,scoresPerBatch:expected.length,referenceScores:expected},
  initialization:{compileAndInstantiateMs:initializeMs,firstImageUploadMs,warmImageUpload:statistics(uploadSamples)},
  javascript:statistics(js),rust:statistics(rust),
  memory:{initialWasmCapacityBytes:initialMemoryBytes,afterWarmupWasmCapacityBytes:afterWarmupMemoryBytes,finalWasmCapacityBytes:core.memory.buffer.byteLength,retainedImageBytes,retainedAfter24MasksBytes,peakLiveArenaBytes:peakBytes,liveArenaBytesAfterDispose:liveBytes,allocationCountForOneImageAnd24Masks:allocationCount}
};
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv[2]) {const destination=resolve(process.argv[2]);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,json)}
process.stdout.write(json);
