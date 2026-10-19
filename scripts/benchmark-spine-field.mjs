// Compare the previous compiled shelf module with the candidate. Numeric/interop
// benchmark only: no canvas/GPU rendering or whole-app/mobile speed claim.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const baseline=process.argv[2];if(!baseline)throw Error('Usage: node scripts/benchmark-spine-field.mjs BASELINE_WASM_DIRECTORY [report.json]');
async function load(dir){const module=await import(pathToFileURL(resolve(dir,'inhouse_read_shelf.js')).href);await module.default({module_or_path:readFileSync(resolve(dir,'inhouse_read_shelf_bg.wasm'))});return module;}
const old=await load(baseline),current=await load('src/wasm/shelf');
let output;
globalThis.document={createElement(){return {width:0,height:0,getContext(){return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}},putImageData(image){output=image.data}}}}}};
const context={save(){},restore(){},drawImage(){}};
function paint(module,options){let s=17;module.paint_field(context,180,1024,()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296},options);return output;}
const cases=[{}, {cells:[4,30],spread:9}, {cells:[64,64],spread:120,channel:true}, {cells:[12,16],spread:600}];
const report=[];
function seededPaint(module,options,fast){let state=17;if(fast)module.paint_field_seeded(context,180,1024,state,options);else module.paint_field(context,180,1024,()=>{state=state+0x6d2b79f5|0;let t=Math.imul(state^state>>>15,1|state);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296},options);return output;}
for(const options of cases){assert.deepEqual(seededPaint(current,options,true),seededPaint(old,options,false));const times={old:[],current:[]};for(let r=0;r<11;r++)for(const name of r%2?['old','current']:['current','old']){const module=name==='old'?old:current,start=performance.now();for(let n=0;n<50;n++)seededPaint(module,options,name==='current');times[name].push((performance.now()-start)/50)}const median=a=>[...a].sort((a,b)=>a-b)[5];report.push({mode:'owned seeded stream',options,oldMs:median(times.old),currentMs:median(times.current),ratio:median(times.old)/median(times.current),equalBytes:true});}

for(const options of cases){assert.deepEqual(paint(current,options),paint(old,options));for(let i=0;i<10;i++){paint(old,options);paint(current,options)}const times={old:[],current:[]};for(let r=0;r<11;r++)for(const name of r%2?['old','current']:['current','old']){const module=name==='old'?old:current,start=performance.now();for(let n=0;n<50;n++)paint(module,options);times[name].push((performance.now()-start)/50)}const median=a=>[...a].sort((a,b)=>a-b)[5];report.push({options,oldMs:median(times.old),currentMs:median(times.current),ratio:median(times.old)/median(times.current),equalBytes:true});}
const result={scope:'Node synthetic ImageData and host-callback interop. No GPU or phone measurements.',report};
console.log(JSON.stringify(result,null,2));if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
