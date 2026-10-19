// @vitest-environment node
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { rustShelf, shelfWasm } from './helpers/rust-shelf-ready.js';
import { createGravityFrame } from '../../src/js/gravity-frame.js';

const bay={left:0,right:600,bottom:300,ceiling:10};
function entry(key,x,kind='book') { return {key,kind,x,y:200,width:150,height:200,depth:150,depthInset:0,thickness:20,shelf:0,
 bits:2,dragNumberX:0,dragNumberY:0,gripHeight:0,lift:{value:0,from:0,target:0,started:0},landing:null,
 preview:{x:0,y:0,fromX:0,fromY:0,targetX:0,targetY:0,started:0,active:false},offset:{x:0,y:0}}; }
// Original frame packing, retained independently to catch adapter field/order regressions.
function oldPack(entries,states,geometry) {
 const io=new Float64Array(37);
 entries.forEach((e,i)=>{
  const kind=e.kind==='plant'?1:e.kind==='lamp'?2:0,undershelf=e.mount==='undershelf',l=e.lift,p=e.preview,a=e.landing;
  io[0]=kind;io[1]=undershelf?1:0;io[2]=e.bits;io[3]=e.dragNumberX;io[4]=e.dragNumberY;
  io[5]=l.value;io[6]=l.from;io[7]=l.target;io[8]=l.started;io[9]=a?1:0;
  if(a){io[10]=a.from;io[11]=a.started;io[12]=a.duration;}
  io[13]=p.x;io[14]=p.y;io[15]=p.fromX;io[16]=p.fromY;io[17]=p.targetX;io[18]=p.targetY;io[19]=p.started;io[20]=p.active?1:0;
  io[21]=e.offset.x;io[22]=e.offset.y;io[23]=e.x;io[24]=e.y;io[25]=e.width;io[26]=e.height;io[27]=e.depth;io[28]=e.depthInset;
  states.set(io,i*37);geometry.set([kind?e.width:e.thickness,undershelf?3:kind,e.shelf||0,1000,bay.left||0,bay.right??600,
   bay.bottom??e.y+e.height/2,bay.ceiling??bay.top??0,e.gripHeight||0],i*9);
 });
}
const bytes=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength);
// Frozen host composition, including the implicit Euler order of decorations.
function originalPose(e,state,out,at,width=600){
 const decorative=e.kind==='plant'||e.kind==='lamp',lamp=e.kind==='lamp',under=lamp&&e.mount==='undershelf';
 const pose=new THREE.Object3D(); if(decorative)pose.rotation.order='ZYX';
 pose.position.set(state[29],state[30],state[31]);let moving=false;
 if(!decorative){
  pose.position.x=e.x-width/2+out[at+1];pose.position.y=-e.y+out[at+2];moving=out[at+3]!==0;
  pose.rotation.set(state[32],state[33],state[34]+out[at],out[at]===0?'XYZ':'ZYX');
 }else{
  pose.rotation.set(state[32],state[33],state[34]);
  if(!under&&e.collisionStamp){pose.position.x=e.x-width/2+out[at+1];pose.position.y=-e.y-(lamp?e.height/2:0)+out[at+2];moving=out[at+3]!==0;}
 }
 pose.scale.setScalar(state[35]);pose.updateMatrix();
 return {pose,moving,flags:e.bits|(out[at+3]?16:0)|(Math.abs(out[at])>.001?32:0)};
}
for (const isometric of [false,true]) for (const reduced of [false,true]) it(`matches physics and final Three poses (iso=${isometric}, reduced=${reduced})`,()=>{
 const legacy=new rustShelf.RustBookGravity(),native=new rustShelf.RustBookGravity(),frame=createGravityFrame(rustShelf);
 const scene=new rustShelf.RustScene(600,1200,600,250,false,isometric,0),read=new Float64Array(40);
 const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(isometric?.16:0,isometric?-.32:0,0));
 let entries=[entry('\ud800',80),entry('\udfff',120),entry('📚',165),entry('plant:p',380,'plant'),entry('lamp:puck',250,'lamp'),entry('lamp:standing',480,'lamp')];
 entries[3].width=45;entries[3].height=90;entries[3].y=255;entries[4].mount='undershelf';entries[5].collisionStamp='lamp';entries[5].width=45;entries[5].height=90;entries[5].y=300;
 try {
  for(let tick=0;tick<300;tick++){
   if(tick===30)for(const e of entries.slice(1))e.bits=0;
   if(tick>30&&tick<100){entries[0].dragNumberX=(tick-30)*.65;entries[0].dragNumberY=-12;}
   if(tick===100){entries[0].bits=0;entries[0].x+=entries[0].dragNumberX;entries[0].dragNumberX=0;entries[0].dragNumberY=0;}
   if(tick===170)entries=[entries[2],entries[1],entries[0],entries[4],entries[3]];
   if(tick===190)entries[0].bits=65;
   if(tick===220)entries[0].bits=0;
   if(tick===240)entries=entries.slice(0,4);
   if(tick===60)entries[3].collisionStamp='plant';
   if(tick===75)entries[3].collisionStamp=null;
   if(tick===45){entries[3].preview={x:0,y:0,fromX:0,fromY:0,targetX:4,targetY:2,started:tick*1000/60,active:true};}
   if(tick===100)entries[0].landing={from:entries[0].lift.value,started:tick*1000/60,duration:180};
   const now=tick*1000/60;
   scene.beginEntries(now,reduced,isometric?1.6:1,new Float64Array(rotation.toArray()),1,600,0,18);
   const states=new Float64Array(entries.length*37),geometry=new Float64Array(entries.length*9),out=new Float64Array(entries.length*4);
   oldPack(entries,states,geometry); frame.prepare(entries);
   entries.forEach((e,i)=>frame.write(i,e,e.kind==='plant'?1:e.kind==='lamp'?2:0,e.mount==='undershelf',bay,1000,600));
   legacy.step(entries.map(e=>e.key),states,geometry,scene,now,reduced,out);frame.advance(native,scene,now,reduced);
   expect(bytes(frame.output),`physics frame ${tick}`).toEqual(bytes(out));
   entries.forEach((e,i)=>{
    frame.copyState(i,read);
    const raw=states.subarray(i*37,(i+1)*37),expected=originalPose(e,raw,out,i*4);
    const expectedState=raw.slice();expectedState.set(expected.pose.position.toArray(),29);expectedState.set([expected.pose.rotation.x,expected.pose.rotation.y,expected.pose.rotation.z],32);
    // Inactive landing payload slots are deliberately unspecified.
    for(const j of [...Array(37).keys()].filter(j=>j<10||j>12))expect(read[j],`state ${tick}/${i}/${j}`).toBe(expectedState[j]);
    expect(read[38]).toBe(Number(expected.moving));expect(read[39]).toBe(expected.flags);
    const actual=new THREE.Object3D(),decorative=e.kind==='plant'||e.kind==='lamp';if(decorative)actual.rotation.order='ZYX';
    actual.position.set(read[29],read[30],read[31]);
    if(decorative)actual.rotation.set(read[32],read[33],read[34]);else actual.rotation.set(read[32],read[33],read[34],read[37]?'ZYX':'XYZ');
    actual.scale.setScalar(read[35]);actual.updateMatrix();
    expect(actual.rotation.order).toBe(expected.pose.rotation.order);
    expect(actual.quaternion.toArray()).toEqual(expected.pose.quaternion.toArray());
    expect(actual.matrix.elements).toEqual(expected.pose.matrix.elements);
    if(!read[9])e.landing=null;
    e.lift.value=read[5];e.lift.from=read[6];e.lift.target=read[7];e.lift.started=read[8];
    e.preview.x=read[13];e.preview.y=read[14];e.preview.active=!!read[20];
   });
  }
  expect(native.snapshot()).toBe(legacy.snapshot());
 } finally {frame.free();legacy.free();native.free();scene.free();}
});
it('retains direct inputs across memory growth and publishes stable outputs across later native work',()=>{
 const frame=createGravityFrame(rustShelf),solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,false,false,0);
 const entries=[entry('a',80),entry('b',200)];
 try{
  frame.prepare(entries);frame.write(0,entries[0],0,false,bay,1000,600);shelfWasm.memory.grow(1);
  frame.write(1,entries[1],0,false,bay,1000,600);scene.beginEntries(0,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
  frame.advance(solver,scene,0,false);const saved=frame.output.slice();shelfWasm.memory.grow(1);
  const state=new Float64Array(37);frame.copyState(0,state);expect(state[23]).toBe(80);frame.copyState(1,state);expect(state[23]).toBe(200);
  expect(frame.output).toEqual(saved);
  frame.prepare([]);frame.advance(solver,scene,16,false);expect(frame.output).toHaveLength(0);
  frame.prepare(entries.slice().reverse());frame.write(0,entries[1],0,false,bay,1000,600);frame.copyState(0,state);expect(state[23]).toBe(200);
 }finally{frame.free();solver.free();scene.free();}
 expect(()=>frame.prepare(entries)).toThrow('disposed');expect(()=>frame.advance(solver,scene,0,false)).toThrow('disposed');frame.free();
});
it('releases registered JS identities on disposal and does not retain prior layouts',()=>{
 const before=rustShelf.shelf_live_handles();
 for(let i=0;i<40;i++){
  const frame=createGravityFrame(rustShelf);
  frame.prepare([entry('one\ud800',80),entry('two\udfff',140)]);
  frame.prepare([entry('replacement',200)]);frame.free();
 }
 expect(rustShelf.shelf_live_handles()).toBe(before);
});
