// What a property read, write or method call by name costs the shelf module (rust-ui/src/host.rs), measured
// on real users of it: the lamp studio's frame (catalog_studio.rs studio_render, per frame while a tint eases)
// and the scene's one-off room recipes (scene_room.rs). Two builds of the module are driven with the same
// calls in interleaved rounds; medians, microseconds per call. Node/WASM, no DOM.
// node scripts/benchmark-host-access.mjs <dir of the build before> [dir of the build now]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
const load=async dir=>{const module=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);module.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return module;};
const before=await load(process.argv[2]),now=await load(process.argv[3]||'src/wasm/shelf');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const clockNs=()=>Number(process.hrtime.bigint());
globalThis.requestAnimationFrame=()=>7;
function compare(label,make,loops=2000,rounds=41){
 const a=make(before),b=make(now);
 const time=fn=>{const start=clockNs();for(let i=0;i<loops;i++)fn();return(clockNs()-start)/loops/1000;};
 for(let i=0;i<10;i++){time(a);time(b);}
 const old=[],next=[];
 for(let round=0;round<rounds;round++){if(round%2){next.push(time(b));old.push(time(a));}else{old.push(time(a));next.push(time(b));}}
 console.log(`${label.padEnd(34)} before ${median(old).toFixed(3).padStart(8)} us   now ${median(next).toFixed(3).padStart(8)} us   ${(median(next)/median(old)*100).toFixed(0)} %`);
}
const fresh=(tint,dirty)=>({kind:2,frame:0,disposed:false,active:true,drawable:true,pending:false,building:0,incoming:null,shown:true,dirty,model:{},render(){},
 host:{retint:()=>tint,draw(){}}});
const studio=(tint,dirty)=>rust=>{const state=fresh(tint,dirty);return()=>{state.dirty=dirty;rust.studio_render(state);};};
// The same frame as the original JavaScript ran it, for scale.
const js=(tint,dirty)=>{
 const state=fresh(tint,dirty);
 const hidden=()=>globalThis.document?.visibilityState==='hidden';
 const request=()=>{if(!state.disposed&&state.active&&!state.frame&&!hidden())state.frame=requestAnimationFrame(state.render);};
 return()=>{state.dirty=dirty;state.frame=0;if(state.disposed||!state.active||!state.drawable||hidden())return;
  if(state.pending&&!state.building)state.building=setTimeout(state.build,0);
  const showing=state.model&&state.shown;let tinting=false;
  if(state.kind===2&&showing){const code=state.host.retint(performance.now());tinting=(code&1)!==0;if(code&2)state.dirty=true;}
  if(!showing||!state.dirty)return;state.dirty=false;state.host.draw(state.model);if(tinting)request();};
};
{const time=fn=>{const start=clockNs();for(let i=0;i<20000;i++)fn();return(clockNs()-start)/20000/1000;};
 const a=js(3,false),b=js(0,false);for(let i=0;i<10;i++){time(a);time(b);}
 console.log(`the same frame written in JavaScript: easing ${median(Array.from({length:21},()=>time(a))).toFixed(3)} us, at rest ${median(Array.from({length:21},()=>time(b))).toFixed(3)} us`);}
compare('lamp studio frame, tint easing',studio(3,false));
compare('lamp studio frame, at rest',studio(0,false));
const pose={matrix:[1,2,3],scale:.6},rect={left:4,right:30,top:-2,bottom:90,width:26,height:92,closest:.5},stage={left:10,top:80};
compare('book pose',rust=>()=>rust.scene_book_pose(pose,rect,stage));
const held={model:new THREE.Object3D(),height:180},point=new THREE.Vector3(3,40,1),button={getBoundingClientRect:()=>({top:0,height:200})};
compare('grip',rust=>()=>rust.scene_object_grip(held,button,50,point));
const lamp={kelvin:2700,lampTint:{set(){}}};
compare('lamp kelvin',rust=>()=>rust.scene_lamp_kelvin(lamp,4000,true,()=>lamp.lampTint));
compare('insertion record',rust=>()=>rust.scene_insertion_record({},false,180,()=>{},null,null));
const floor=new THREE.Mesh(new THREE.BoxGeometry(1,2,1)),wall=new THREE.Mesh(new THREE.PlaneGeometry(1,1)),room=Float64Array.from({length:11},(_,i)=>i*3+1);
compare('floor and wall',rust=>()=>rust.scene_room_floor(THREE,floor,wall,room));
const model=new THREE.Object3D(),bin={userData:{openness:.3}},resolveDrop=()=>{};
compare('bin drop record',rust=>()=>rust.scene_trash_drop_record(THREE,resolveDrop,1000,false,850,model,bin));
const texture=new THREE.Texture(),grain=new THREE.Texture(),wide=material=>material;
compare('room materials',rust=>()=>rust.scene_room_materials(THREE,texture,grain,wide,new THREE.Group(),()=>{}),300);
