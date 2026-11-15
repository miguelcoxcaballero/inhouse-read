// What moved into rust-ui/src/scene_rects.rs, against the host code of 1.7.339
// (tests/unit/helpers/reference-scene-rects.js):
//  - a tap that missed every mesh: the host's walk of every entry's objects (and each button's
//    live class), or one call over the arena;
//  - the read of a button whose class, or whose drag variables, changed: two or three calls and
//    the entry's own fields, or one call that also writes the entry's row;
//  - a frame that moved every button: the copy of each target into two objects per entry, gone;
//  - a reorder's release (cold).
// Node/WASM, no DOM or GPU: a button is an object with the fields the code reads. Interleaved
// rounds, medians.
// With the directory of a 1.7.339 shelf build as second argument, the hit stage of a frame is
// also measured on both builds (`hits` now marks each row whose target it took).
// node scripts/benchmark-scene-rects.mjs [dir with the current shelf build] [dir of a 1.7.339 build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {createReferenceTap,referenceReorder,referenceStateFor,referenceCopyTarget} from '../tests/unit/helpers/reference-scene-rects.js';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneEntryFrame,ENTRY_STATE:S,HIT_INPUT,HIT_OUTPUT}=await import('../src/js/scene-entry-frame.js');
const {createSceneProjectionFrame}=await import('../src/js/scene-projection-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const rounds=(label,unit,times,previous,current)=>{
 const olds=[],news=[];
 for(let round=0;round<25;round++){
  let t=performance.now();for(let i=0;i<times;i++)previous(i);olds.push((performance.now()-t)/times*1000);
  t=performance.now();for(let i=0;i<times;i++)current(i);news.push((performance.now()-t)/times*1000);
 }
 console.log(`${label}: ${median(olds).toFixed(3)} -> ${median(news).toFixed(3)} ${unit} (x${(median(olds)/median(news)).toFixed(2)})`);
};
let sink=0;
for(const count of [40,120,300]){
 const frame=createSceneEntryFrame(rust),projection=createSceneProjectionFrame(rust),scene=new rust.RustScene(600,1200,600,250,false,true,0);
 const style=()=>({drag:['',''],pointerEvents:'',getPropertyValue(name){return this.drag[name==='--ihr-drag-x'?0:1];}});
 const entries=Array.from({length:count},(_,i)=>{const kind=i%12===3?'lamp':i%12===7?'plant':undefined;
  const node={className:'ihr-shelf-book ihr-book-spine',disabled:false,style:style(),dataset:{objectId:`o${i}`},classList:{contains:name=>node.className.includes(name)}};
  return {kind,key:`${kind||'book'}:${i}`,book:kind?undefined:{id:`b${i}`},node,row:-1,rect:{left:i*9,top:40},hitRect:null,tapRect:undefined,flags:{away:false,dragging:false},bits:0,
   classText:null,dragX:'',dragY:'',dragNumberX:0,dragNumberY:0,stateText:'',
   model:{id:100+i,visible:true,userData:{overview:false,inspectionResolution:0}},trashDrop:null,insertion:null,plantQuality:null,qualityReplacement:false,replacementReady:false};});
 frame.bind(entries,true);projection.prepare(entries);frame.hold(entries);frame.refresh();
 entries.forEach((entry,index)=>{frame.state[index*S]=entry.kind==='plant'?1:entry.kind==='lamp'?2:0;frame.hitInput[index*HIT_INPUT]=1;});
 scene.beginEntries(0,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
 frame.hits(projection.native,scene);frame.refresh();
 // Spines side by side, each padded to a finger's width: neighbours overlap, as on a shelf.
 entries.forEach((entry,index)=>{const h=index*HIT_OUTPUT,hit=frame.hitOutput;
  hit[h]=8192;hit[h+1]=index*9+15;hit[h+3]=40;hit[h+8]=index*9;hit[h+9]=40;hit[h+10]=44;hit[h+11]=220;
  referenceCopyTarget(entry,hit,h,entry.kind==='plant');});
 const origin={left:12,top:60},referenceTap=createReferenceTap(rust);
 const liveTap=(clientX,clientY)=>{
  for(let index=-1;;){
   index=frame.lamp.tapNear(clientX,clientY,origin.left,origin.top,index);
   const node=index<0?null:entries[index].node;
   if(index<0||node&&!node.classList.contains('is-away'))return node;
  }
 };
 for(let i=0;i<count*9+60;i+=7)assert.equal(liveTap(i+12.5,200),referenceTap(entries,origin,i+12.5,200));
 rounds(`${count} entries, a tap beside the spines`,'us',4000,i=>{if(referenceTap(entries,origin,(i*37)%(count*9)+12.5,200))sink++;},i=>{if(liveTap((i*37)%(count*9)+12.5,200))sink++;});
 // The read of a button: its class changed (a press), or its drag variables did (a drag's move).
 const twins=entries.map(entry=>({node:{className:entry.node.className,disabled:false,style:style()},classText:null,bits:0,dragX:'',dragY:'',dragNumberX:0,dragNumberY:0,stateText:''}));
 const lives=entries.map(entry=>({node:{className:entry.node.className,disabled:false,style:style()},row:entry.row,classText:null,bits:0,dragX:'',dragY:'',stateText:''}));
 const stateFor=entry=>{
  const node=entry.node;
  const classes=node.className,dragX=node.style.getPropertyValue('--ihr-drag-x'),dragY=node.style.getPropertyValue('--ihr-drag-y');
  const disabled=Boolean(node.disabled),pointerEvents=node.style.pointerEvents;
  if(classes===entry.classText&&dragX===entry.dragX&&dragY===entry.dragY&&disabled===entry.controlDisabled&&pointerEvents===entry.controlPointerEvents)return entry.stateText;
  entry.classText=classes;entry.dragX=dragX;entry.dragY=dragY;entry.controlDisabled=disabled;entry.controlPointerEvents=pointerEvents;
  entry.stateText=frame.lamp.domState(entry.row,classes,dragX,dragY,disabled,pointerEvents);
  frame.refresh();entry.bits=frame.state[entry.row*S+2];
  return entry.stateText;
 };
 // The frame's own write of the three columns after the read (1.7.339), which the call now does.
 const mirror=entry=>{frame.refresh();const at=entry.row*S,state=frame.state;state[at+2]=entry.bits;state[at+3]=entry.dragNumberX;state[at+4]=entry.dragNumberY;};
 const press=['ihr-shelf-book ihr-book-spine','ihr-shelf-book ihr-book-spine is-pressed'];
 for(let i=0;i<4;i++){twins[0].node.className=lives[0].node.className=press[i&1];assert.equal(stateFor(lives[0]),referenceStateFor(rust,twins[0]));}
 rounds(`${count} entries, the read of a button whose class changed`,'us',20000,i=>{const twin=twins[i%count];twin.node.className=press[(i/count|0)&1];twin.row=i%count;if(referenceStateFor(rust,twin))sink++;mirror(twin);},
  i=>{const live=lives[i%count];live.node.className=press[(i/count|0)&1];if(stateFor(live))sink++;});
 const drags=Array.from({length:64},(_,i)=>`${(i*3.25-90).toFixed(2)}px`);
 rounds(`${count} entries, the read of a button whose drag variables changed`,'us',20000,i=>{const twin=twins[0];twin.node.style.drag[0]=drags[i&63];twin.node.style.drag[1]=drags[i+7&63];twin.row=0;if(referenceStateFor(rust,twin))sink++;mirror(twin);},
  i=>{const live=lives[0];live.node.style.drag[0]=drags[i&63];live.node.style.drag[1]=drags[i+7&63];if(stateFor(live))sink++;});
 // A frame that moved every button (a turning room): the copy the third loop no longer makes.
 rounds(`${count} entries, the targets' copy of a frame that moved them all`,'us per frame',4000,()=>{const hit=frame.hitOutput;for(let index=0;index<count;index++)referenceCopyTarget(entries[index],hit,index*HIT_OUTPUT,entries[index].kind==='plant');},()=>{});
 // A reorder's release: every third button eases from 30 px away.
 const oldRects=new Map(entries.filter((_,index)=>index%3===0).map(entry=>[entry.node.dataset.objectId,{left:entry.tapRect?entry.tapRect.left+42:entry.hitRect.left+42,top:100}]));
 const stageRect={left:12,top:60};
 const liveReorder=()=>{
  const olds=new Float64Array(entries.length*5);
  entries.forEach((entry,index)=>{
   const old=oldRects.get(entry.node?.dataset.objectId)||oldRects.get(entry.book?.id)||oldRects.get(entry.node?.dataset.bookId)||oldRects.get(entry.key),rect=entry.rect,at=index*5;
   if(old){olds[at]=old.left;olds[at+1]=old.top;olds[at+2]=3;}
   if(rect){olds[at+2]+=4;olds[at+3]=rect.left;olds[at+4]=rect.top;}
  });
  frame.lamp.reorderFrom(olds,stageRect.left,stageRect.top,5);
 };
 rounds(`${count} entries, a reorder's release begins (cold)`,'us',2000,()=>{const {items}=referenceReorder(entries,oldRects,stageRect,'o0',()=>0,5);frame.lamp.reorder(items);sink+=items.length;},liveReorder);
 frame.free();projection.free();scene.free();
}
if(process.argv[3]){
 const old=await import(pathToFileURL(resolve(process.argv[3])+'/inhouse_read_shelf.js').href);
 old.initSync({module:readFileSync(resolve(process.argv[3])+'/inhouse_read_shelf_bg.wasm')});
 for(const count of [40,120,300]){
  const side=module=>{
   const frame=createSceneEntryFrame(module),projection=createSceneProjectionFrame(module),scene=new module.RustScene(600,1200,600,250,false,true,0);
   const entries=Array.from({length:count},()=>({row:-1}));
   frame.bind(entries,true);projection.prepare(entries);frame.refresh();
   entries.forEach((entry,index)=>{frame.state[index*S]=index%12===7?1:index%12===3?2:0;const h=index*HIT_INPUT;frame.hitInput[h]=1;
    frame.hitInput.set([-3,-80,-2,3,80,2,1,0,0,0,0,1,0,0,0,0,1,0,20+index*9,-300,0,1],h+2);});
   scene.beginEntries(0,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
   return ()=>{frame.hits(projection.native,scene);};
  };
  const previous=side(old),current=side(rust);
  rounds(`${count} entries, the hit stage of a frame at rest (1.7.339 build -> this build)`,'us per frame',4000,previous,current);
  // A layout: every entry keeps its row (a record or a size changed), or the order is reversed.
  const binder=module=>{const frame=createSceneEntryFrame(module),entries=Array.from({length:count},()=>({row:-1}));frame.bind(entries,true);
   return reverse=>{if(reverse)entries.reverse();frame.bind(entries,true);};};
  const before=binder(old),after=binder(rust);
  rounds(`${count} entries, a layout that keeps the rows (cold; 1.7.339 build -> this build)`,'us',600,()=>before(false),()=>after(false));
  rounds(`${count} entries, a layout that reverses them (cold; 1.7.339 build -> this build)`,'us',600,()=>before(true),()=>after(true));
 }
}
console.log(sink>0?'':'');
