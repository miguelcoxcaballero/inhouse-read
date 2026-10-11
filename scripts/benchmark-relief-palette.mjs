import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reliefPaletteCases} from '../tests/helpers/relief-palette-cases.mjs';
import {observeReliefPalette} from '../tests/helpers/relief-palette-benchmark.mjs';
const hash=async value=>createHash('sha256').update(ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):value).digest('hex');
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const actual=(await WebAssembly.instantiate(bytes)).instance.exports,stats={jobs:0,liveJobs:0,releases:0};
const core={...actual,relief_palette_new(n){const p=actual.relief_palette_new(n);if(p){stats.jobs++;stats.liveJobs++;}return p;},
  relief_palette_free(p){actual.relief_palette_free(p);stats.releases++;stats.liveJobs--;}};
globalThis.__inhousePaletteBenchmarkCore=core;
const sources=[];
async function load(relative){
  const url=new URL(relative,import.meta.url),source=await readFile(url,'utf8');sources.push({path:relative,sha256:await hash(source)});
  const transformed=source.replace(/import \{ getRustCore, loadRustCore \} from '[^']+rust-core\.js';/,
    'const getRustCore=()=>globalThis.__inhousePaletteBenchmarkCore; const loadRustCore=async()=>getRustCore();')
    .replace(/from '(\.[^']+)'/g,(_,path)=>`from '${new URL(path,url).href}'`);
  return import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
}
const original=await load('../tests/unit/helpers/reference-relief-palette.js'),production=await load('../src/js/cover-relief.js');
const measurements=[];
for(const input of reliefPaletteCases)measurements.push(await observeReliefPalette({input,original,production,core,hash,stats}));
const report={runtime:process.version,artifact:{bytes:bytes.length,sha256:await hash(bytes)},sources,measurements};
await writeFile(process.argv[2],JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify(measurements.map(({input,stages})=>({name:input.name,palette:[stages.palette.javascriptMedianMs,stages.palette.rustMedianMs],full:[stages.full.javascriptMedianMs,stages.full.rustMedianMs]}))));
