// Full host API benchmark: normalization, allocation, the complete Rust layout,
// owned copies, object hydration and free. Desktop timings are not phone FPS.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { rustShelfPlacement } from '../src/js/shelf-placement-wasm.js';
import * as plain from '../tests/unit/helpers/reference-shelf-placement.js';
import * as decoration from '../tests/unit/helpers/reference-shelf-decoration-layout.js';
import { placementBenchCases,placementFixture,originalPlacement } from '../tests/helpers/shelf-placement-cases.mjs';
import { targetsFor,placementOptions,canonicalPlacement,placementChecksum } from '../tests/helpers/shelf-placement-benchmark.mjs';
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const started=performance.now(),{instance}=await WebAssembly.instantiate(bytes),core=instance.exports;
const initializationMs=performance.now()-started;assert.equal(typeof core.shelf_place,'function');
const hash=data=>createHash('sha256').update(data).digest('hex');
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const measurements=[];
for(const input of placementBenchCases){
  const fixture=placementFixture(input),targets=targetsFor(fixture,input),proof=[];
  let live=0,peak=0,allocations=0,releases=0,calls=0;
  const tracked={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n*8;peak=Math.max(peak,live);allocations++;}return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n*8;releases++;},
    shelf_place(...args){calls++;return core.shelf_place(...args);}};
  for(const target of targets){
    const expected=originalPlacement(plain,decoration,fixture,input.api,target);
    const actual=rustShelfPlacement(tracked,fixture.objects,fixture.options,placementOptions(fixture,input.api,target));
    assert.notEqual(actual,undefined);assert.deepEqual(actual,expected);
    proof.push({target,sha256:hash(canonicalPlacement(expected))});
  }
  assert.equal(live,0);assert.equal(allocations,releases);assert.equal(calls,targets.length);
  const repetitions=input.sequence?1:input.count>=1000?2:input.count>=200?8:32;
  const rounds=9,warmups=2,samples={javascript:[],rust:[]},orders=[];
  const run=rust=>{let checksum=0;for(let n=0;n<repetitions;n++)for(const target of targets){
    const result=rust?rustShelfPlacement(core,fixture.objects,fixture.options,placementOptions(fixture,input.api,target))
      :originalPlacement(plain,decoration,fixture,input.api,target);
    checksum+=placementChecksum(result);
  }return checksum;};
  const checksum=run(false);assert.equal(run(true),checksum);
  for(let i=0;i<warmups;i++){assert.equal(run(false),checksum);assert.equal(run(true),checksum);}
  for(let round=0;round<rounds;round++){
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const begin=performance.now();const actual=run(kind==='rust');samples[kind].push(performance.now()-begin);assert.equal(actual,checksum);}
  }
  measurements.push({input,proof,inputSha256:hash(canonicalPlacement(fixture)),methodology:{rounds,warmups,repetitions,placementsPerRepetition:targets.length},samples,orders,
    javascriptPerPlacementMedianMs:median(samples.javascript)/(repetitions*targets.length),
    rustPerPlacementMedianMs:median(samples.rust)/(repetitions*targets.length),
    memory:{liveArenaBytes:live,peakLiveArenaBytes:peak,allocations,releases,calls,wasmCapacityBytes:core.memory.buffer.byteLength}});
}
const report={createdAt:new Date().toISOString(),runtime:process.version,cpu:cpus()[0]?.model,
  artifact:{bytes:bytes.length,sha256:hash(bytes),initializationMs},measurements};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));
else process.stdout.write(JSON.stringify(report,null,2)+'\n');
