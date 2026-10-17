// CPU diagnostic, not a battery or phone temperature measurement.
// node scripts/measure-shelf-wake.mjs /path/to/baseline/shelf-bindings
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const paths={...(process.argv[2]?{before:resolve(process.argv[2])}:{}),after:resolve('src/wasm/shelf')};
const med=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
for(const [label,path]of Object.entries(paths)){
 const api=await import(pathToFileURL(path+'/inhouse_read_shelf.js').href);api.initSync({module:readFileSync(path+'/inhouse_read_shelf_bg.wasm')});
 const runs=[];let unrelated=0;
 for(let repeat=0;repeat<5;repeat++){
  const count=72,scene=new api.RustScene(600,8000,600,250,false,false,0),solver=new api.RustBookGravity();
  let clock=0;const keys=Array.from({length:count},(_,i)=>'book:'+i),out=new Float64Array(count*4),geo=new Float64Array(count*9),states=new Float64Array(count*37);
  const step=(flags=0,drag=0)=>{
   scene.beginEntries(clock,false,1,new Float64Array([0,0,0,1]),1,600,0,18);states.fill(0);
   for(let i=0;i<count;i++){const row=Math.floor(i/3),floor=300+row*320;
    states.set([0,0,i===0?flags:0,i===0?drag:0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,80+i%3*50,floor-100,150,200,150,0],i*37);
    geo.set([20,0,row,1000,0,600,floor,floor-290+(row>0?15/.65-10:0),0],i*9);
   }
   solver.step(keys,states,geo,scene,clock,false,out);clock+=1000/60;
  };
  for(let f=0;f<600;f++)step();
  if(out.some((v,i)=>i%4===3&&v!==0))throw Error(label+' did not initially settle');
  const started=performance.now();step(2);unrelated=Math.max(unrelated,Array.from(out).filter((v,i)=>i>=12&&i%4===3&&v!==0).length);
  for(let f=1;f<=60;f++)step(2,f);
  runs.push(performance.now()-started);solver.free();scene.free();
 }
 console.log(JSON.stringify({label,books:72,dragFrames:61,medianMs:med(runs),runs,unrelatedAwakeOnPickup:unrelated}));
}
