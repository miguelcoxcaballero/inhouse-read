// Node cannot import Vite's ?url WASM loader. The frozen candidate mirror
// differs from the staged production source only in relative import paths
// and an injected getRustCore; Chromium additionally uses production itself.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {createShelfPlant as original,plantSurfacesReady as originalReady} from '../tests/unit/helpers/reference-shelf-plants.js';
import {createShelfPlant as candidate,plantSurfacesReady as candidateReady,setPlantBenchmarkCore} from '../tests/helpers/candidate-shelf-plants.js';
import {plantModelCases,expectedPlantLeafCalls} from '../tests/helpers/plant-leaf-cases.mjs';
import {benchmarkPlantModel} from '../tests/helpers/plant-geometry-benchmark.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const start=performance.now(),{instance}=await WebAssembly.instantiate(bytes),core=instance.exports;
const initializationMs=performance.now()-start;assert.equal(typeof core.plant_leaf_mesh,'function');
const source=await readFile(new URL('../src/js/shelf-plants.js',import.meta.url),'utf8');
const actualMirror=await readFile(new URL('../tests/helpers/candidate-shelf-plants.js',import.meta.url),'utf8');
const expectedMirror=source.replace("import { getRustCore } from './rust-core.js';",
  'let benchmarkCore = null; const getRustCore = () => benchmarkCore; export const setPlantBenchmarkCore = core => { benchmarkCore = core; };')
  .replaceAll("from './","from '../../src/js/");
assert.equal(actualMirror,expectedMirror,'Node candidate mirror must equal current production with exactly the documented loader transform');
const measurements=[];
for(const entry of plantModelCases) {
  const stats={calls:0,allocations:0,releases:0,live:0,peak:0};
  setPlantBenchmarkCore({...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.allocations++;stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
    free_f64(p,n){stats.releases++;stats.live-=n*8;core.free_f64(p,n);},
    plant_leaf_mesh(...args){stats.calls++;return core.plant_leaf_mesh(...args);}});
  const result=await benchmarkPlantModel({original,candidate,originalReady,candidateReady,entry,stats,expectedCalls:expectedPlantLeafCalls[entry.catalogId]});
  assert.equal(stats.live,0);assert.equal(stats.allocations,stats.releases);measurements.push(result);
}
const report={createdAt:new Date().toISOString(),runtime:process.version,cpu:cpus()[0]?.model,
  artifact:{bytes:bytes.length,sha256:sha(bytes),initializationMs},sourceSha256:sha(source),mirrorSha256:sha(actualMirror),measurements};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2));else process.stdout.write(JSON.stringify(report,null,2)+'\n');
