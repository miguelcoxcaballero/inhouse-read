// The host's side of a scene frame, per entry: what bookshelf-scene.js does with the entry
// arena's results (pose, projected rectangle, model transform, hit surface, hit target, button
// styles). `previous` is the loop as it stood before entries at rest were skipped (every
// rectangle copied, every model's transform copied, the room and the scene composed again for
// every hit surface); `current` copies what the arena says moved and walks the room once.
// Both sides run the same native calls on their own arenas, three objects and stand-in buttons;
// rectangles, world matrices and written styles are asserted equal first.
// Node/WASM, no DOM, GPU or battery measurement. Interleaved rounds, medians.
// node scripts/benchmark-scene-entry-apply.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneMotionFrame}=await import('../src/js/scene-motion-frame.js');
const {createSceneProjectionFrame}=await import('../src/js/scene-projection-frame.js');
const {createSceneEntryFrame,ENTRY_STATE:S,ENTRY_OUTPUT,HIT_INPUT,HIT_OUTPUT}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const perShelf=28,width=perShelf*21+20;
const button=()=>({style:{},dataset:{},disabled:false,inert:false});
function side(count){
 const scene=new THREE.Scene(),furniture=new THREE.Group();scene.add(furniture);furniture.rotation.set(.244,-.524,0);
 const entries=Array.from({length:count},(_,i)=>{
  const lamp=i%23===7,plant=i%19===11,shelf=Math.floor(i/perShelf),slot=i%perShelf;
  const model=new THREE.Group(),inner=new THREE.Group();model.add(inner);
  for(let k=0;k<5;k++){const part=new THREE.Mesh(new THREE.BoxGeometry(18,200,150));part.name=k===2?'binding':`part${k}`;part.position.x=k;inner.add(part);}
  furniture.add(model);
  return {kind:lamp?'lamp':plant?'plant':undefined,key:`e:${i}`,shelf,x:20+slot*21,y:200+shelf*300,width:lamp||plant?40:150,height:lamp||plant?60:200,depth:150,depthInset:0,
   box:Float64Array.of(-9,-100,-75,9,100,75),fallback:Float64Array.of(-9,-100,-75,9,100,75),bits:0,dragNumberX:0,dragNumberY:0,model,node:button(),pose:new THREE.Object3D(),
   row:-1,stale:true,rect:null,hitRect:null,tapRect:null,written:null,posed:null,trashDrop:null,insertion:null,overview:false};
 });
 const c={scene,furniture,entries,sceneView:new rust.RustScene(width,1200,width,250,false,false,0),roomMotion:new rust.RustRoomMotion(),roomTransition:new rust.RustRoomTransition(),
  motionFrame:createSceneMotionFrame(rust,()=>null),projectionFrame:createSceneProjectionFrame(rust),entryFrame:createSceneEntryFrame(rust),covers:new Map(),sink:0};
 c.entryFrame.bind(entries,true);
 return c;
}
const hitSurface=entry=>{const model=entry.model,cached=model.userData.hitSurface;return cached?.parent?cached:model.userData.hitSurface=model.getObjectByName('binding');};
const rows=count=>Array.from({length:Math.ceil(count/perShelf)},(_,shelf)=>({left:0,right:width,bottom:300+shelf*300,ceiling:10+shelf*300}));
// Shared by both sides: what changed enters the state arena and one native call poses every entry.
function begin(c,now,scroll,bays){
 const {entries,entryFrame}=c;
 c.furniture.updateWorldMatrix(true,false);
 c.sceneView.beginEntries(now,false,1,[0,0,0,1],2,width,scroll,44);
 c.projectionFrame.prepare(entries);c.motionFrame.prepare(entries,bays,width,1000);
 entryFrame.refresh();
 for(let index=0;index<entries.length;index++){
  const e=entries[index],at=index*S,state=entryFrame.state,kind=e.kind==='plant'?1:e.kind==='lamp'?2:0;
  if(e.stale){e.stale=false;state[at]=kind;state[at+1]=0;state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state[at+28]=e.depthInset;state.set(e.box,at+50);}
  state[at+2]=e.bits;state[at+3]=e.dragNumberX;state[at+4]=e.dragNumberY;state[at+49]=4;
 }
 return entryFrame.poses(c.motionFrame.native,c.sceneView,c.roomMotion,c.roomTransition,now,false,c.furniture.matrixWorld);
}
function refreshWorldBelowRoom(object,furniture){
 const parent=object.parent;
 if(parent!==null&&parent!==furniture)refreshWorldBelowRoom(parent,furniture);
 if(object.matrixAutoUpdate)object.updateMatrix();
 if(object.matrixWorldAutoUpdate===true){if(parent===null)object.matrixWorld.copy(object.matrix);else object.matrixWorld.multiplyMatrices(parent.matrixWorld,object.matrix);}
}
function styles(c,entry,node,dirtyStyle,hit,h,plant,lamp){
 const rect=entry.rect,tapLeft=hit[h+8],tapTop=hit[h+9],tapWidth=hit[h+10],tapHeight=hit[h+11];
 const zIndex=hit[h+12],coverLeft=hit[h+13],coverTop=hit[h+14],coverShown=hit[h+15],coverEvents=hit[h+16];
 if(dirtyStyle&63){const style=node.style;
  if(dirtyStyle&1)style.position='absolute';if(dirtyStyle&2)style.left=`${tapLeft}px`;if(dirtyStyle&4)style.top=`${tapTop}px`;
  if(dirtyStyle&8)style.width=`${tapWidth}px`;if(dirtyStyle&16)style.height=`${tapHeight}px`;if(dirtyStyle&1)style.margin='0';if(dirtyStyle&32)style.zIndex=String(zIndex);}
 if(dirtyStyle&1){node.dataset.sceneProjected='true';node.dataset.sceneHitSurface=plant?'pot':lamp?'lamp':'spine';}
 if(!plant){
  let coverHit=c.covers.get(node);
  if(!coverHit){coverHit={style:{}};c.covers.set(node,coverHit);}
  if(dirtyStyle&8128){const coverStyle=coverHit.style;
   if(dirtyStyle&64)coverStyle.position='absolute';if(dirtyStyle&128)coverStyle.left=`${coverLeft}px`;if(dirtyStyle&256)coverStyle.top=`${coverTop}px`;
   if(dirtyStyle&512)coverStyle.width=`${rect.width}px`;if(dirtyStyle&1024)coverStyle.height=`${rect.height}px`;if(dirtyStyle&2048)coverStyle.display=coverShown?'block':'none';
   if(dirtyStyle&64)coverStyle.background='transparent';if(dirtyStyle&4096)coverStyle.pointerEvents=coverEvents?'inherit':'none';}
 }
}
function hitInput(c,entry,entryIndex,node,surface,plant){
 const hits=c.entryFrame.hitInput,h=entryIndex*HIT_INPUT,{min,max}=surface.geometry.boundingBox;
 hits[h+2]=min.x;hits[h+3]=min.y;hits[h+4]=min.z;hits[h+5]=max.x;hits[h+6]=max.y;hits[h+7]=max.z;hits.set(surface.matrixWorld.elements,h+8);
 const resetHit=entry.written?.node!==node;
 if(resetHit)entry.written={node};
 hits[h]=1|(resetHit?8:0)|(!plant&&!c.covers.has(node)?16:0);hits[h+1]=entry.bits;
}
function pose(entry,state,row,live,at,changed,liveFlags){
 const pose=entry.pose;
 if(changed&1){pose.position.set(state[row+29],state[row+30],state[row+31]);pose.rotation.set(state[row+32],state[row+33],state[row+34],state[row+56]?'ZYX':'XYZ');pose.scale.setScalar(state[row+35]);}
 if(liveFlags&2){pose.position.set(live[at+10],live[at+11],live[at+12]);pose.quaternion.set(live[at+13],live[at+14],live[at+15],live[at+16]);pose.scale.setScalar(live[at+17]);}
 if(liveFlags&4){pose.position.set(live[at+18],live[at+19],live[at+20]);pose.quaternion.set(live[at+21],live[at+22],live[at+23],live[at+24]);pose.scale.setScalar(live[at+25]);}
 if(changed&2){pose.matrix.fromArray(live,at+26);pose.matrixWorldNeedsUpdate=true;}
}
// The loops as they stood before (bookshelf-scene.js at 8f8390a0).
function previous(c){
 const {entries,entryFrame}=c;
 for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
  const entry=entries[entryIndex],node=entry.node,plant=entry.kind==='plant';
  entryFrame.refresh();
  const live=entryFrame.output,at=entryIndex*ENTRY_OUTPUT,liveFlags=live[at],state=entryFrame.state,row=entryIndex*S,changed=state[row+70];
  pose(entry,state,row,live,at,changed,liveFlags);
  const rect=entry.rect||(entry.rect={});
  rect.left=live[at+58];rect.right=live[at+59];rect.top=live[at+60];rect.bottom=live[at+61];rect.width=live[at+62];rect.height=live[at+63];rect.closest=live[at+64];
  const modelVisible=live[at+69]===1;
  if(entry.model.visible!==modelVisible)c.sink++;
  entry.model.visible=modelVisible;
  entry.model.position.copy(entry.pose.position);entry.model.rotation.copy(entry.pose.rotation);entry.model.scale.copy(entry.pose.scale);
  entryFrame.refresh();
  const surface=hitSurface(entry);
  if(!surface.geometry.boundingBox)surface.geometry.computeBoundingBox();
  surface.updateWorldMatrix(true,false);
  hitInput(c,entry,entryIndex,node,surface,plant);
 }
 entryFrame.hits(c.projectionFrame.native,c.sceneView);
 for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
  const entry=entries[entryIndex],node=entry.node,plant=entry.kind==='plant',lamp=entry.kind==='lamp';
  entryFrame.refresh();
  const hit=entryFrame.hitOutput,h=entryIndex*HIT_OUTPUT,dirtyStyle=hit[h]&8191;
  const hitRect=entry.hitRect||(entry.hitRect={});
  hitRect.left=hit[h+1];hitRect.right=hit[h+2];hitRect.top=hit[h+3];hitRect.bottom=hit[h+4];hitRect.width=hit[h+5];hitRect.height=hit[h+6];hitRect.closest=hit[h+7];
  if(!plant){const tapRect=entry.tapRect||(entry.tapRect={});tapRect.left=hit[h+8];tapRect.top=hit[h+9];tapRect.width=hit[h+10];tapRect.height=hit[h+11];}
  styles(c,entry,node,dirtyStyle,hit,h,plant,lamp);
 }
}
// The loops as bookshelf-scene.js runs them now.
function current(c){
 const {entries,entryFrame,furniture}=c;
 let roomWalked=false;
 for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
  const entry=entries[entryIndex],node=entry.node,plant=entry.kind==='plant';
  entryFrame.refresh();
  const live=entryFrame.output,at=entryIndex*ENTRY_OUTPUT,liveFlags=live[at],state=entryFrame.state,row=entryIndex*S,changed=state[row+70];
  pose(entry,state,row,live,at,changed,liveFlags);
  if(changed&4||!entry.rect){
   const rect=entry.rect||(entry.rect={});
   rect.left=live[at+58];rect.right=live[at+59];rect.top=live[at+60];rect.bottom=live[at+61];rect.width=live[at+62];rect.height=live[at+63];rect.closest=live[at+64];
  }
  const modelVisible=live[at+69]===1;
  if(entry.model.visible!==modelVisible)c.sink++;
  entry.model.visible=modelVisible;
  if(entry.posed!==entry.model||changed&1||liveFlags&6){
   entry.posed=entry.model;
   entry.model.position.copy(entry.pose.position);entry.model.rotation.copy(entry.pose.rotation);entry.model.scale.copy(entry.pose.scale);
  }
  entryFrame.refresh();
  const surface=hitSurface(entry);
  if(!surface.geometry.boundingBox)surface.geometry.computeBoundingBox();
  if(roomWalked)refreshWorldBelowRoom(surface,furniture);
  else{surface.updateWorldMatrix(true,false);for(let above=surface.parent;above;above=above.parent)if(above===furniture){roomWalked=true;break;}}
  hitInput(c,entry,entryIndex,node,surface,plant);
 }
 entryFrame.hits(c.projectionFrame.native,c.sceneView);
 for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
  const entry=entries[entryIndex],node=entry.node,plant=entry.kind==='plant',lamp=entry.kind==='lamp';
  entryFrame.refresh();
  const hit=entryFrame.hitOutput,h=entryIndex*HIT_OUTPUT,dirtyStyle=hit[h];
  if(dirtyStyle===0&&entry.hitRect)continue;
  if(dirtyStyle&8192||!entry.hitRect){
   const hitRect=entry.hitRect||(entry.hitRect={});
   hitRect.left=hit[h+1];hitRect.right=hit[h+2];hitRect.top=hit[h+3];hitRect.bottom=hit[h+4];hitRect.width=hit[h+5];hitRect.height=hit[h+6];hitRect.closest=hit[h+7];
  }
  if(!plant&&(dirtyStyle&8192||!entry.tapRect)){const tapRect=entry.tapRect||(entry.tapRect={});tapRect.left=hit[h+8];tapRect.top=hit[h+9];tapRect.width=hit[h+10];tapRect.height=hit[h+11];}
  styles(c,entry,node,dirtyStyle,hit,h,plant,lamp);
 }
}
const picture=c=>{c.scene.updateMatrixWorld();return JSON.stringify(c.entries.map(e=>[e.rect,e.hitRect,e.tapRect,e.node.style,e.node.dataset,c.covers.get(e.node)?.style,
 e.model.position.toArray(),e.model.quaternion.toArray(),e.model.rotation.toArray(),e.model.scale.toArray(),hitSurface(e).matrixWorld.elements.map(v=>Object.is(v,-0)?'-0':v)]));};
// `one lifting`: one book is pressed and released in turn, the others rest. `scrolling`: the
// page scrolls, so every rectangle and button moves while no pose does. `turning`: the room
// turns, so everything moves (nothing can be skipped: the cost of asking).
for(const count of [40,120,300])for(const mode of ['one lifting','scrolling','turning']){
 const o=side(count),n=side(count),bays=rows(count);
 const events=(c,tick)=>{
  if(mode==='one lifting')c.entries[1].bits=Math.floor(tick/12)%2?8:0;
  if(mode==='turning'){c.furniture.rotation.y=-.524+Math.sin(tick*.05)*.2;}
  return mode==='scrolling'?Math.abs(Math.sin(tick*.03))*600:0;
 };
 const frame=(c,apply,tick)=>{const scroll=events(c,tick);c.sink+=begin(c,tick*16,scroll,bays);apply(c);};
 try{
  let clock=0;
  for(;clock<120;clock++){frame(o,previous,clock);frame(n,current,clock);assert.equal(picture(n),picture(o),`${mode} ${count} tick ${clock}`);}
  const loops=120;let oldTick=clock,newTick=clock,baseTick=clock;
  const base=side(count);
  const timeBase=()=>{const start=performance.now();for(let i=0;i<loops;i++)frame(base,()=>{},baseTick++);return(performance.now()-start)/loops;};
  const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)frame(o,previous,oldTick++);return(performance.now()-start)/loops;};
  const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)frame(n,current,newTick++);return(performance.now()-start)/loops;};
  const shared=[],old=[],now=[];
  for(let round=0;round<21;round++){shared.push(timeBase());if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
  assert.equal(picture(n),picture(o),`${mode} ${count} after timing`);
  results.push({count,mode,posesOnlyMs:+median(shared).toFixed(4),previousMs:+median(old).toFixed(4),currentMs:+median(now).toFixed(4),speedup:+(median(old)/median(now)).toFixed(2),
   sink:Number.isFinite(o.sink+n.sink)});
  for(const c of [base])free(c);
 }finally{free(o);free(n);}
}
function free(c){c.entryFrame.free();c.projectionFrame.free();c.motionFrame.free();c.sceneView.free();c.roomMotion.free();c.roomTransition.free();}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'scene frame per entry: native poses and hits plus the host loops, Node/WASM',results},null,1));
