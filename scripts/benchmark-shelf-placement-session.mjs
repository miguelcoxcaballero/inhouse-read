// Complete drag cost: inspect/copy/normalize once, all placements including
// every WASM allocation/copy/free and full result hydration, then disposal.
// No preparation is moved outside the timed Rust operation.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { createShelfPlacementPreview,SHELF_PREVIEW_MIN_OBJECTS,SHELF_PREVIEW_DIRECT_MOVES } from '../src/js/shelf-placement-preview.js';
import { moveShelfDecoration } from '../tests/unit/helpers/reference-shelf-decoration-layout.js';
import { shelfSessionCases,shelfSessionFixture } from '../tests/helpers/shelf-placement-session-cases.mjs';
import { canonicalPlacement,placementChecksum } from '../tests/helpers/shelf-placement-benchmark.mjs';
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const started=performance.now(),{instance}=await WebAssembly.instantiate(bytes),core=instance.exports;
const initializationMs=performance.now()-started;assert.equal(typeof core.shelf_place,'function');
const hash=data=>createHash('sha256').update(data).digest('hex');
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const measurements=[];
for(const input of shelfSessionCases){
  const {fixture,targets}=shelfSessionFixture(input),proof=[];
  let live=0,peak=0,allocations=0,releases=0,calls=0;
  const tracked={...core,
    alloc_f64(n){const pointer=core.alloc_f64(n);if(pointer){live+=n*8;peak=Math.max(peak,live);allocations++;}return pointer;},
    free_f64(pointer,n){core.free_f64(pointer,n);live-=n*8;releases++;},
    shelf_place(...args){calls++;return core.shelf_place(...args);}};
  const session=createShelfPlacementPreview(fixture.objects,fixture.options);
  assert.notEqual(session,null);assert.equal(allocations,0);
  try{
    for(const target of targets){
      const expected=moveShelfDecoration(fixture.objects,fixture.movedKey,target,fixture.options);
      const actual=session.move(tracked,fixture.movedKey,target.shelf,target.x);
      assert.notEqual(actual,undefined);assert.deepEqual(actual,expected);
      proof.push({target,sha256:hash(canonicalPlacement(expected))});
    }
  }finally{session.dispose();}
  const expectedCalls=input.count>=SHELF_PREVIEW_MIN_OBJECTS?Math.max(0,targets.length-SHELF_PREVIEW_DIRECT_MOVES):0;
  assert.equal(live,0);assert.equal(allocations,releases);assert.equal(calls,expectedCalls);
  const repetitions=input.moves===1&&input.count<=40?32:input.moves<=8&&input.count<=200?4:1;
  const rounds=9,warmups=2,samples={javascript:[],rust:[]},orders=[];
  const run=rust=>{
    let checksum=0;
    for(let n=0;n<repetitions;n++){
      const drag=rust?createShelfPlacementPreview(fixture.objects,fixture.options):null;
      if(rust)assert.notEqual(drag,null);
      try{
        for(const target of targets){
          const result=rust?drag.move(core,fixture.movedKey,target.shelf,target.x)
            :moveShelfDecoration(fixture.objects,fixture.movedKey,target,fixture.options);
          checksum+=placementChecksum(result);
        }
      }finally{drag?.dispose();}
    }
    return checksum;
  };
  const checksum=run(false);assert.equal(run(true),checksum);
  for(let index=0;index<warmups;index++){assert.equal(run(false),checksum);assert.equal(run(true),checksum);}
  for(let round=0;round<rounds;round++){
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const begin=performance.now();const actual=run(kind==='rust');samples[kind].push(performance.now()-begin);assert.equal(actual,checksum);}
  }
  measurements.push({input,proof,inputSha256:hash(canonicalPlacement(fixture)),
    methodology:{rounds,warmups,repetitions,movesPerDrag:targets.length,preparationIncluded:true,disposalIncluded:true,publicApisUnchanged:true,
      policy:{minimumObjects:SHELF_PREVIEW_MIN_OBJECTS,initialJavaScriptMoves:SHELF_PREVIEW_DIRECT_MOVES}},
    proofRouting:{rustCalls:calls,javascriptBypasses:targets.length-calls,contextPrepared:calls>0},
    samples,orders,javascriptPerDragMedianMs:median(samples.javascript)/repetitions,rustPerDragMedianMs:median(samples.rust)/repetitions,
    javascriptPerMoveAmortizedMs:median(samples.javascript)/(repetitions*targets.length),
    rustPerMoveAmortizedMs:median(samples.rust)/(repetitions*targets.length),
    memory:{liveArenaBytes:live,peakLiveArenaBytes:peak,allocations,releases,calls,
      preparedGeometryBytes:calls?fixture.objects.length*7*8:0,wasmCapacityBytes:core.memory.buffer.byteLength}});
}
const report={createdAt:new Date().toISOString(),runtime:process.version,cpu:cpus()[0]?.model,
  artifact:{bytes:bytes.length,sha256:hash(bytes),initializationMs},measurements};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));
else process.stdout.write(JSON.stringify(report,null,2)+'\n');
