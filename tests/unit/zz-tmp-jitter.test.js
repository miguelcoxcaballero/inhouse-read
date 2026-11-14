// @vitest-environment node
// TEMPORARY local reproduction, never committed.
import {readFileSync} from 'node:fs'
import {plantGeometrySpec} from '../../src/js/decor-geometry-spec.js'
import {expect,it} from 'vitest'
import {rustShelf} from './helpers/rust-shelf-ready.js'
const dump=JSON.parse(readFileSync(process.env.DUMP80,'utf8'))
function run({rowsOnly=null,reduced=true,frames=400,frameMs=1000/60,plants=true}={}){
 const f=dump.first,all=dump.keys.map((key,i)=>({key,i,state:f.states.slice(i*37,i*37+37).map(v=>v??NaN),geometry:f.geometry.slice(i*9,i*9+9)}));
 const entries=all.filter(e=>(rowsOnly===null||rowsOnly.includes(e.geometry[2]))&&(plants||e.state[0]!==1));
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(1201.2,783,1201.2,250,false,false,0);
 const specs=JSON.parse(dump.plants);
 for(const e of entries)if(e.state[0]===1){const p=e.geometry[3],plant=specs.find(s=>s.key===e.key),v=plantGeometrySpec({...plant,height:e.state[26],width:e.state[25]});
  solver.decoration(e.key,1,v.potId||'',v.potModelId||'',Float64Array.of(v.real.potDiameter/2*v.unit/p,v.real.potHeight*v.unit/p,v.height/p,0));}
 let clock=0,output,history=[];
 for(let frame=0;frame<frames;frame++){
  scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,390,0,18);
  const states=new Float64Array(entries.length*37),geometry=new Float64Array(entries.length*9);
  entries.forEach((e,i)=>{states.set(e.state.slice(0,29),i*37);states.fill(0,i*37+5,i*37+23);states[i*37+12]=1;geometry.set(e.geometry,i*9);});
  output=new Float64Array(entries.length*4);solver.step(entries.map(e=>e.key),states,geometry,scene,clock,reduced,output);clock+=frameMs;
  history.push({active:entries.filter((e,i)=>output[i*4+3]).length,angles:Array.from({length:entries.length},(_,i)=>output[i*4]),xs:Array.from({length:entries.length},(_,i)=>output[i*4+1])});
 }
 const last=history.at(-1),firstQuiet=history.findIndex(h=>h.active===0);
 const tail=history.slice(-100),band=entries.map((e,i)=>({key:e.key.replace('book:long-shelf:','b').replace('plant:empty-shelf-','P'),angle:+last.angles[i].toFixed(4),da:+(Math.max(...tail.map(h=>h.angles[i]))-Math.min(...tail.map(h=>h.angles[i]))).toFixed(5),dx:+((Math.max(...tail.map(h=>h.xs[i]))-Math.min(...tail.map(h=>h.xs[i])))/650*1000).toFixed(4)})).filter(b=>b.da>0||b.dx>0);
 const series=(process.env.SERIES||'').split(',').filter(Boolean).map(name=>{const i=entries.findIndex(e=>e.key.endsWith(name));return {name,a:history.slice(-240).map(h=>+h.angles[i].toFixed(5)),x:history.slice(-240).map(h=>+(h.xs[i]/650*1000).toFixed(3))}});
 for(const q of series){const win=(n,arr)=>{let m=0;for(let k=0;k+n<=arr.length;k+=Math.max(1,n>>1)){const w=arr.slice(k,k+n);m=Math.max(m,Math.max(...w)-Math.min(...w));}return +m.toFixed(5)};console.info('SERIES',q.name,'angle range per 45f/180f/240f',win(45,q.a),win(180,q.a),win(240,q.a),'x mm',win(45,q.x),win(180,q.x),win(240,q.x),'sample',q.a.filter((_,k)=>k%12===0).join(' '));}
 solver.free();scene.free();
 return {entries:entries.length,firstQuiet,activeAtEnd:last.active,band};
}
it('reproduces the 80-book shelf',()=>{
 for(const options of JSON.parse(process.env.CASES||'[{"rowsOnly":[0]},{"rowsOnly":[0],"plants":false},{"rowsOnly":[0],"reduced":false,"frames":3000}]')){
  const r=run(options);console.info('JITTER',JSON.stringify(options),JSON.stringify({entries:r.entries,firstQuiet:r.firstQuiet,activeAtEnd:r.activeAtEnd,moving:r.band.length,band:r.band.slice(0,14)}));
 }
 expect(true).toBe(true);
},600000);
