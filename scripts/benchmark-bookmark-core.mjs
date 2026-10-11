// Reused/fresh ribbon arithmetic and BufferGeometry update benchmark only.
// Usage: node scripts/benchmark-bookmark-core.mjs [output.json]
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import * as THREE from 'three';
import { referenceBookmarkGeometry } from '../tests/unit/helpers/reference-bookmark-geometry.js';
import { rustBookmarkBuffers, releaseRustBookmarkBuffers } from '../src/js/bookmark-wasm.js';

const WARMUPS=5, BATCHES=15;
const fixtures=[
  {width:132,height:200,thickness:40,progress:.25,peek:10,segments:8,seed:0},
  {width:264,height:400,thickness:80,progress:.45,peek:16,segments:32,seed:12345},
  {width:62.125,height:92.375,thickness:8.25,progress:.98,peek:23,segments:32,seed:65520}
];
const poses=[];
for(let i=0;i<=16;i++)poses.push({open:i/16,withdraw:0});
for(let i=1;i<=12;i++)poses.push({open:1,withdraw:i/12});
for(let i=11;i>=0;i--)poses.push({open:1,withdraw:i/12});
for(let i=15;i>=0;i--)poses.push({open:i/16,withdraw:0});
// A simultaneous cover/ribbon state is also used by composite animations.
poses.push({open:.6,withdraw:.1},{open:0,withdraw:0});
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const initializedAt=performance.now();
const {instance}=await WebAssembly.instantiate(bytes);
const initializationMs=performance.now()-initializedAt,core=instance.exports;
assert.equal(core.core_abi_version(),1);assert.equal(typeof core.bookmark_mesh,'function');
const initialMemoryBytes=core.memory.buffer.byteLength;

// Same BufferGeometry installation contract as bookmarkGeometry's Rust path.
// Include the host coefficients, WASM call, view lookup, all output copies,
// update versions and fresh topology allocation in the measured function.
function rustGeometry(fixture,pose,target) {
  const {width,height,thickness,progress,peek,segments,seed}=fixture;
  const buffers=rustBookmarkBuffers(core,width,height,thickness,progress,peek,pose.open,pose.withdraw,segments,seed);
  assert.ok(buffers);
  const reuse=target?.getAttribute('position')?.count===buffers.positions.length/3
    && target.getAttribute('uv')?.count===buffers.uvs.length/2 && target.index?.count===buffers.indices.length;
  const geometry=reuse?target:new THREE.BufferGeometry();
  if(reuse) {
    geometry.getAttribute('position').array.set(buffers.positions);
    geometry.getAttribute('uv').array.set(buffers.uvs);
    geometry.getAttribute('position').needsUpdate=true;
    geometry.getAttribute('uv').needsUpdate=true;
    geometry.boundingBox=geometry.boundingSphere=null;
  } else {
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(buffers.positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(buffers.uvs,2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(buffers.indices,1));
  }
  const normal=geometry.getAttribute('normal');
  if(normal?.count===buffers.normals.length/3)normal.array.set(buffers.normals);
  else geometry.setAttribute('normal',new THREE.Float32BufferAttribute(buffers.normals,3));
  geometry.getAttribute('normal').needsUpdate=true;
  return geometry;
}
function originalGeometry(fixture,pose,target) {
  const {width,height,thickness,progress,peek,segments,seed}=fixture;
  return referenceBookmarkGeometry(width,height,thickness,progress,peek,{...pose,segments,seed,geometry:target});
}
const versions=geometry=>[geometry.attributes.position.version,geometry.attributes.uv.version,geometry.attributes.normal.version,geometry.index.version];
const arrayBytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function exactGeometry(actual,expected) {
  for(const name of ['position','normal','uv'])assert.deepEqual(arrayBytes(actual.attributes[name].array),arrayBytes(expected.attributes[name].array),`${name} changed`);
  assert.deepEqual(arrayBytes(actual.index.array),arrayBytes(expected.index.array),'topology changed');
  assert.deepEqual(versions(actual),versions(expected),'attribute update versions changed');
}
const firstStart=performance.now(),first=rustGeometry(fixtures[0],poses[0]);
const firstGeometryMs=performance.now()-firstStart;first.dispose();
let parityPairs=0;
for(const mode of ['fresh','reused'])for(const fixture of fixtures) {
  let actual,expected,actualAttributes,expectedAttributes;
  try {
    for(const pose of poses) {
      actual=rustGeometry(fixture,pose,mode==='reused'?actual:null);
      expected=originalGeometry(fixture,pose,mode==='reused'?expected:null);
      exactGeometry(actual,expected);parityPairs++;
      if(mode==='reused') {
        const a=[actual.attributes.position,actual.attributes.uv,actual.attributes.normal,actual.index];
        const e=[expected.attributes.position,expected.attributes.uv,expected.attributes.normal,expected.index];
        if(actualAttributes)for(let i=0;i<a.length;i++){assert.equal(a[i],actualAttributes[i]);assert.equal(e[i],expectedAttributes[i])}
        actualAttributes=a;expectedAttributes=e;
      } else {actual.dispose();expected.dispose();actual=expected=null}
    }
  } finally {actual?.dispose();expected?.dispose()}
}

function run(build,mode) {
  let checksum=0,count=0;
  const finalVersions=[];
  for(const fixture of fixtures) {
    let geometry;
    try {
      for(const pose of poses) {
        geometry=build(fixture,pose,mode==='reused'?geometry:null);
        // Observe real applied output; validation itself remains outside the
        // timed interval. Identical loop order gives an exact f64 checksum.
        checksum+=geometry.attributes.position.array[1]+geometry.attributes.normal.array[7]+geometry.attributes.uv.array[3];
        count++;
        if(mode==='fresh') {geometry.dispose();geometry=null}
      }
      if(geometry)finalVersions.push(versions(geometry));
    } finally {geometry?.dispose()}
  }
  return {checksum,count,finalVersions};
}
const statistics=samples=>{
  const sorted=[...samples].sort((a,b)=>a-b);
  return {samples,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],totalMs:samples.reduce((a,b)=>a+b,0)};
};
const measurements={};
for(const mode of ['fresh','reused']) {
  const expected=run(originalGeometry,mode);
  for(let i=0;i<WARMUPS;i++){assert.deepEqual(run(originalGeometry,mode),expected);assert.deepEqual(run(rustGeometry,mode),expected)}
  const javascript=[],rust=[],orders=[];
  for(let batch=0;batch<BATCHES;batch++) {
    const order=batch%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const engine of order) {
      const start=performance.now(),result=run(engine==='rust'?rustGeometry:originalGeometry,mode),elapsed=performance.now()-start;
      assert.deepEqual(result,expected);
      (engine==='rust'?rust:javascript).push(elapsed);
    }
  }
  measurements[mode]={javascript:statistics(javascript),rust:statistics(rust),orders,expected};
}

// Instrument allocation after timings. The wrappers delegate all allocation
// and mesh operations to the actual artifact; no replacement kernel is used.
let liveBytes=0,peakBytes=0,allocations=0;
const tracked={...core,
  alloc_f64(length){const pointer=core.alloc_f64(length);if(pointer){liveBytes+=length*8;peakBytes=Math.max(peakBytes,liveBytes);allocations++}return pointer},
  free_f64(pointer,length){core.free_f64(pointer,length);liveBytes-=length*8}
};
for(const fixture of fixtures)for(const pose of poses) {
  rustBookmarkBuffers(tracked,fixture.width,fixture.height,fixture.thickness,fixture.progress,fixture.peek,pose.open,pose.withdraw,fixture.segments,fixture.seed);
}
const retainedScratchBytes=liveBytes;
const retainedTopologyBytes=[...new Set(fixtures.map(fixture=>fixture.segments))].reduce((sum,steps)=>sum+(steps*24+12)*2,0);
releaseRustBookmarkBuffers(tracked);
assert.equal(liveBytes,0);
const report={
  benchmark:'bookmark-rust-vs-original',generatedAt:new Date().toISOString(),
  environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model},
  scope:'Desktop Node geometry arithmetic and CPU BufferGeometry installation. Excludes browser/GPU/driver work, rendering and animation scheduling. Does not establish mobile or whole-app speed.',
  artifact:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},
  methodology:{fixtures,poses,meshesPerBatch:fixtures.length*poses.length,warmupBatchesPerEngine:WARMUPS,measuredBatchesPerEngine:BATCHES,includes:'Rust includes original host transcendental coefficients, cached arena views, Rust crosssections/normals, copying all geometry attributes, and fresh or reused topology as specified. Both include geometry disposal. Parity validates all bytes, attribute versions and reused attribute identities before timing.'},
  parity:{exact:true,pairs:parityPairs},initialization:{compileAndInstantiateMs:initializationMs,firstGeometryMs},measurements,
  memory:{initialWasmCapacityBytes:initialMemoryBytes,finalWasmCapacityBytes:core.memory.buffer.byteLength,retainedScratchBytes,retainedTopologyBytes,retainedCpuCacheDataBytes:retainedScratchBytes+retainedTopologyBytes,peakLiveArenaBytes:peakBytes,liveArenaBytesAfterRelease:liveBytes,arenaAllocationsForAllPoses:allocations}
};
releaseRustBookmarkBuffers(core);
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv[2]){const destination=resolve(process.argv[2]);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,json)}
process.stdout.write(json);
