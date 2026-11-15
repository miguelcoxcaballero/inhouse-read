// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {createLampReference} from './helpers/reference-scene-lamp.js';
import {createSceneEntryFrame,ENTRY_STATE as S} from '../../src/js/scene-entry-frame.js';
import {createSceneMotionFrame} from './helpers/scene-motion-frame.js';

// Every lamp's switch fade and tint live in the entry arena and ease inside the pose call
// (rust-ui/src/scene_lamp.rs). Against the frozen per-lamp JavaScript (helpers/reference-scene-lamp.js),
// over random switches, temperatures, layouts, models, buttons and clocks: the same calls reach the
// models and the buttons with the same numbers, bit for bit, in the same order, and the modal's and
// the gesture's questions get the same answers.
let seed=20261115;
const random=()=>(seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296,chance=p=>random()<p,pick=list=>list[Math.floor(random()*list.length)];
const kelvins=[2200,2700,3000,4000,5000,6500],defaultKelvin=2700,ms=300;
const tints=new Map(kelvins.map((k,i)=>[k,k===defaultKelvin?[1,1,1]:[1+Math.sin(i)*.31,.9+Math.cos(i*3)*.07,1.4-i*.13]]));
const rows=[{left:0,right:600,bottom:300,ceiling:10}],room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
const bitsOf=value=>{const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);return view.getBigUint64(0).toString(16);};

it('eases every lamp as the frozen per-lamp JavaScript did',()=>{
 let clock=1000;
 const spy=vi.spyOn(performance,'now').mockImplementation(()=>clock);
 const log=[[],[]];
 const setData=side=>(node,key,value)=>{if(node.dataset[key]!==value){node.dataset[key]=value;log[side].push(['data',node.id,key,value]);}};
 const reference=createLampReference({scenePower:rust.scene_lamp_power,tints,kelvins,defaultKelvin,ms,setData:setData(0),clock:()=>performance.now()});
 let ids=0;
 const model=side=>chance(.15)?null:{id:++ids,userData:{shownTint:pick(['1,1,1','']),lightEmitter:chance(.8)?{power:pick([0,1,.4,undefined,null])}:undefined,
  setPower(value){log[side].push(['power',bitsOf(value)]);},setTint(value){log[side].push(['tint',value.map(bitsOf).join()]);}}};
 // The same random choices for both sides.
 const pair=make=>{const state=[seed,ids];const a=make(0);[seed,ids]=state;return [a,make(1)];};
 const scene=new rust.RustScene(600,400,600,250,false,true,0),roomMotion=new rust.RustRoomMotion(),roomTransition=new rust.RustRoomTransition();
 const motionFrame=createSceneMotionFrame(rust,e=>e.kind?e.key:null),frame=createSceneEntryFrame(rust);
 frame.lamp.lampTints([defaultKelvin,...kelvins.flatMap(k=>[k,...tints.get(k)])],ms);
 scene.sizeViewport(800,600,1,new Float64Array(4));
 let keys=0;
 const fresh=()=>{
  const lamp=chance(.7),key=`${lamp?'lamp':'book'}:${++keys}`,on=pick([true,false,undefined]),kelvin=pick([...kelvins,undefined,'3000',1234]);
  const [ma,mb]=pair(model),node=chance(.85)?keys:0;
  const make=m=>({kind:lamp?'lamp':undefined,key,isOn:on,kelvin,shelf:0,x:50,y:200,width:40,height:80,depth:40,depthInset:0,bits:0,row:-1,model:m,
   node:node?{id:node,dataset:{}}:null,insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null,stale:true});
  return [make(ma),make(mb)];
 };
 let olds=[],news=[],moved=[false,false],frames=0,fades=0,eases=0,asked=0;
 const dirty=[0,0];
 const bind=list=>{olds=list.map(p=>p[0]);news=list.map(p=>p[1]);frame.bind(news,true);for(const e of news)e.stale=true;};
 bind(Array.from({length:12},fresh));
 // The scene's own lines (src/js/bookshelf-scene.js updateEntries).
 const current=(now,reduced)=>{
  scene.beginEntries(now,reduced,1,new Float64Array([0,0,0,1]),1,600,0,44);motionFrame.prepare(news,rows,600,1000);
  frame.refresh();
  news.forEach((entry,index)=>{
   if(!entry.stale)return;entry.stale=false;
   const at=index*S,state=frame.state,lamp=entry.kind==='lamp';
   state[at]=lamp?2:0;state[at+23]=entry.x;state[at+24]=entry.y;state[at+25]=entry.width;state[at+26]=entry.height;state[at+27]=entry.depth;
   if(lamp){state[at+91]=entry.isOn===false?0:1;state[at+92]=entry.kelvin;}
  });
  frame.hold(news);
  frame.poses(motionFrame.native,scene,roomMotion,roomTransition,now,false,room);
  let moving=false;
  news.forEach((entry,index)=>{
   if(entry.kind!=='lamp')return;
   const row=index*S,node=entry.node;
   const lamps=frame.state,lit=lamps[row+116],power=lamps[row+94],model=entry.model;
   const tint=lit&4||entry.tinted!==model?[lamps[row+108],lamps[row+109],lamps[row+110]]:null;
   if(lit&2)dirty[1]++;
   if(lit&24)moving=true;
   if(lit&1||entry.lit!==model){entry.lit=model;model?.userData.setPower?.(power);}
   if(node&&(lit&1||entry.litNode!==node)){entry.litNode=node;setData(1)(node,'lampPower',power.toFixed(4));}
   if(model&&tint){
    entry.tinted=model;
    const text=tint.join();
    if(model.userData.shownTint!==text){model.userData.shownTint=text;model.userData.setTint?.(tint);dirty[1]++;}
   }
  });
  return moving;
 };
 for(let round=0;round<60000;round++){
  const action=random(),index=Math.floor(random()*olds.length),old=olds[index],entry=news[index];
  clock+=pick([0,0,1,7,16,16,16,33,120,400]);
  if(action<.5){
   const reduced=chance(.06);
   let moving=false;
   for(const e of olds)if(e.kind==='lamp')moving=reference.advanceLampPower(e,clock,reduced,()=>dirty[0]++)||moving;
   moved=[moving,current(clock,reduced)];frames++;if(moving)eases++;
  }else if(action<.62){
   if(old.kind!=='lamp')continue;
   const on=pick([true,false,undefined,null,0]),animate=chance(.8);
   reference.lampSwitch(old,on,animate);
   frame.lamp.lampSwitch(entry.row,entry.model?.userData.lightEmitter?.power??(entry.isOn===false?0:1),entry.isOn=on!==false,animate);fades++;
  }else if(action<.72){
   if(old.kind!=='lamp')continue;
   const kelvin=pick([...kelvins,...kelvins,undefined,'4000',999]),animate=chance(.8);
   reference.lampKelvin(old,kelvin,animate);
   frame.lamp.lampKelvin(entry.row,entry.kelvin=kelvin,animate);
  }else if(action<.78){
   const [a,b]=pair(model);old.model=a;entry.model=b;
  }else if(action<.82){
   const id=chance(.2)?0:++keys+100000;old.node=id?{id,dataset:{}}:null;entry.node=id?{id,dataset:{}}:null;
  }else if(action<.9){
   // A layout: some entries leave, some arrive, the rest keep their fade and tint; a record may bring another switch or temperature.
   const kept=olds.map((e,i)=>[e,news[i]]).filter(()=>chance(.85));
   for(const p of kept){
    if(chance(.3)){const on=pick([true,false,undefined]);p[0].isOn=p[1].isOn=on;}
    if(chance(.3)){const kelvin=pick([...kelvins,undefined]);p[0].kelvin=p[1].kelvin=kelvin;}
    p[0].lampShown=null;p[1].lit=p[1].litNode=p[1].tinted=null;
   }
   while(kept.length<8||chance(.4))kept.splice(Math.floor(random()*(kept.length+1)),0,fresh());
   bind(kept);
  }else{
   asked++;
   expect(frame.lamp.lampsBusy(clock,true),`modal ${round}`).toBe(reference.modalBusy(olds,clock));
   expect(frame.lamp.lampsBusy(clock,false),`gesture ${round}`).toBe(reference.gestureBusy(olds,clock));
  }
  if(log[0].length||log[1].length){expect(log[1],`round ${round}`).toEqual(log[0]);log[0].length=log[1].length=0;}
  if(dirty[1]!==dirty[0]||moved[1]!==moved[0])expect([dirty[1],moved[1]],`round ${round}`).toEqual([dirty[0],moved[0]]);
 }
 // Every lamp's fade and tint, number for number.
 frame.refresh();
 let compared=0;
 olds.forEach((e,index)=>{
  if(e.kind!=='lamp'||!e.lampPower||!e.lampTint)return;
  const at=index*S,state=frame.state,power=e.lampPower,tint=e.lampTint.state;compared++;
  expect(Array.from(state.subarray(at+94,at+99),bitsOf)).toEqual([power.value,power.from,power.target,power.started,power.duration].map(bitsOf));
  expect(Array.from(state.subarray(at+101,at+113),bitsOf)).toEqual([tint.kelvin,...tint.from,...tint.to,...tint.value,tint.started,tint.duration].map(bitsOf));
 });
 expect(compared).toBeGreaterThan(2);
 expect(frames).toBeGreaterThan(20000);expect(eases).toBeGreaterThan(2000);expect(fades).toBeGreaterThan(1000);expect(asked).toBeGreaterThan(1000);
 expect(dirty[0]).toBeGreaterThan(1000);
 spy.mockRestore();frame.free();
});
