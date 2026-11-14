// @vitest-environment node
// TEMPORARY local reproduction, never committed.
import {readFileSync} from 'node:fs'
import {plantGeometrySpec} from '../../src/js/decor-geometry-spec.js'
import {expect,it} from 'vitest'
import {rustShelf} from './helpers/rust-shelf-ready.js'
const dump=JSON.parse(readFileSync(process.env.DUMP80,'utf8'))
it('trace',()=>{
 const reduced=process.env.REDUCED==='1',frames=Number(process.env.FRAMES||3000),every=Number(process.env.EVERY||150)
 const f=dump.first,all=dump.keys.map((key,i)=>({key,i,state:f.states.slice(i*37,i*37+37).map(v=>v??NaN),geometry:f.geometry.slice(i*9,i*9+9)}));
 const entries=all.filter(e=>e.geometry[2]===0);
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(1201.2,783,1201.2,250,false,false,0);
 const specs=JSON.parse(dump.plants);
 for(const e of entries)if(e.state[0]===1){const p=e.geometry[3],plant=specs.find(s=>s.key===e.key),v=plantGeometrySpec({...plant,height:e.state[26],width:e.state[25]});
  console.info('POT',JSON.stringify({r:v.real.potDiameter/2*v.unit/p,h:v.real.potHeight*v.unit/p,p}));
  solver.decoration(e.key,1,v.potId||'',v.potModelId||'',Float64Array.of(v.real.potDiameter/2*v.unit/p,v.real.potHeight*v.unit/p,v.height/p,0));}
 let clock=0;
 for(let frame=0;frame<frames;frame++){
  scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,390,0,18);
  const states=new Float64Array(entries.length*37),geometry=new Float64Array(entries.length*9);
  entries.forEach((e,i)=>{states.set(e.state.slice(0,29),i*37);states.fill(0,i*37+5,i*37+23);states[i*37+12]=1;geometry.set(e.geometry,i*9);});
  const output=new Float64Array(entries.length*4);solver.step(entries.map(e=>e.key),states,geometry,scene,clock,reduced,output);clock+=1000/60;
  if(frame%every===0||frame===frames-1)console.info('T',frame,entries.slice(0,Number(process.env.N||7)).map((e,i)=>`${(output[i*4]).toFixed(3)}/${(output[i*4+1]).toFixed(1)}/${(output[i*4+2]).toFixed(1)}${output[i*4+3]?'*':' '}`).join(' | '),'active',entries.filter((e,i)=>output[i*4+3]).length);
 }
 expect(true).toBe(true)
},600000)
