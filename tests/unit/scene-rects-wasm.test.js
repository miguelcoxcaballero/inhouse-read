// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneEntryFrame,ENTRY_STATE,HIT_INPUT,HIT_OUTPUT} from '../../src/js/scene-entry-frame.js';
import {createSceneMotionFrame} from '../../src/js/scene-motion-frame.js';
import {createSceneProjectionFrame} from './helpers/scene-projection-frame.js';
import {createReferenceTap,referenceReorder,referenceStateFor,referenceCopyTarget} from './helpers/reference-scene-rects.js';

// The buttons' hit and tap rectangles stay in the entry arena, which answers a tap that missed
// every mesh and begins a reorder's release, and a button's state is read in one call
// (rust-ui/src/scene_rects.rs). The frozen host code (helpers/reference-scene-rects.js), which
// kept two objects per entry, must give the same answers and the same bits.
const S=ENTRY_STATE;
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const odd=[0,-0,NaN,Infinity,-Infinity,1e-310,-1.5,2**53];
const CLASSES=['is-away','is-dragging','is-lifted','is-pressed','is-press-pending','is-reader-origin','ihr-book','is-awayish',''];
const DRAGS=['','0px','12.5px','-3e2px','px','  7px','-0px','NaNpx','1e400px','.5px'];

// The scene's own lines (src/js/bookshelf-scene.js tapTargetNear and animateFromRects).
function liveTap(frame,entries,origin,clientX,clientY){
 for(let index=-1;;){
  index=frame.lamp.tapNear(clientX,clientY,origin.left,origin.top,index);
  const node=index<0?null:entries[index].node;
  if(index<0||node&&!node.classList.contains('is-away'))return node;
 }
}
function liveReorder(frame,entries,oldRects,stageRect,draggedKey,started){
 const olds=new Float64Array(entries.length*5);
 entries.forEach((entry,index)=>{
  const old=oldRects.get(entry.node?.dataset.objectId)||oldRects.get(entry.book?.id)||
   oldRects.get(entry.node?.dataset.bookId)||oldRects.get(entry.key),rect=entry.rect,at=index*5;
  if(old){olds[at]=old.left;olds[at+1]=old.top;olds[at+2]=draggedKey!=null&&String(entry.node?.dataset.objectId??entry.key)===String(draggedKey)?3:1;}
  if(rect){olds[at+2]+=4;olds[at+3]=rect.left;olds[at+4]=rect.top;}
 });
 frame.lamp.reorderFrom(olds,stageRect.left,stageRect.top,started);
}

it('answers taps and begins reorders as the host did from its own rectangles',()=>{
 let taps=0,found=0,asked=0,reorders=0,eased=0,landings=0,fallbacks=0;
 for(let session=0;session<60;session++){
  const next=random(session*104729+11),frame=createSceneEntryFrame(rust),scene=new rust.RustScene(600,900,600,250,false,false,0);
  const motionFrame=createSceneMotionFrame(rust,()=>null),roomMotion=new rust.RustRoomMotion(),roomTransition=new rust.RustRoomTransition();
  const projection=createSceneProjectionFrame(rust),referenceTap=createReferenceTap(rust);
  const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
  const number=()=>next()<.06?odd[Math.floor(next()*odd.length)]:(next()-.5)*900;
  let serial=0;
  const makeNode=()=>{const node={away:false,dataset:{},classList:{contains:name=>name==='is-away'&&node.away}};if(next()<.7)node.dataset.objectId=`o${serial}`;if(next()<.3)node.dataset.bookId=`b${serial}`;return node;};
  const makeEntry=()=>{const dice=next(),kind=dice<.15?'plant':dice<.3?'lamp':undefined;serial++;
   return {kind,key:`${kind||'book'}:${serial}`,book:kind?undefined:{id:`id${serial}`},node:next()<.9?makeNode():null,row:-1,rect:null,hitRect:null,tapRect:undefined,
    flags:{away:false,dragging:false},bits:0,model:next()<.85?{id:1,visible:true,userData:{}}:null,trashDrop:null,insertion:null,plantQuality:null,qualityReplacement:false,replacementReady:false};};
  try{
   let entries=[],now=0;
   const layout=()=>{
    const kept=entries.filter(()=>next()>.15);
    for(let index=kept.length-1;index>0;index--){const other=Math.floor(next()*(index+1));[kept[index],kept[other]]=[kept[other],kept[index]];}
    for(let add=Math.floor(next()*6);add>0;add--)kept.splice(Math.floor(next()*(kept.length+1)),0,makeEntry());
    // A retained entry may take another button, or none.
    for(const entry of kept)if(entry.row>=0&&next()<.1)entry.node=next()<.8?makeNode():null;
    entries=kept;frame.bind(entries,next()<.7);projection.prepare(entries);
   };
   const paint=()=>{
    // A frame: what the host holds and reads, then every button's target (random numbers stand
    // for the projection's), copied into the reference's objects as the frame's third loop did.
    if(next()<.1)shelfWasm.memory.grow(1);
    for(const entry of entries){
     if(next()<.3)entry.model=next()<.85?{id:1,visible:next()<.85,userData:{}}:null;
     if(next()<.1)entry.trashDrop=entry.trashDrop?null:{complete:false};
     if(entry.node&&next()<.2){
      const bits=(next()<.2?1:0)|(next()<.15?2:0)|(next()<.2?4:0);
      entry.bits=bits;entry.flags={away:Boolean(bits&1),dragging:Boolean(bits&2)};
     }
     if(entry.node)entry.node.away=next()<.1?!entry.flags.away:entry.flags.away;
     if(next()<.6)entry.rect=next()<.95?{left:number(),top:number()}:null;
    }
    frame.hold(entries);frame.refresh();
    entries.forEach((entry,index)=>{frame.state[index*S]=entry.kind==='plant'?1:entry.kind==='lamp'?2:0;frame.state[index*S+2]=entry.bits;
     frame.hitInput[index*HIT_INPUT]=entry.node?1:0;});
    scene.beginEntries(now,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
    frame.hits(projection.native,scene);
    frame.refresh();
    entries.forEach((entry,index)=>{
     if(!entry.node)return;
     const h=index*HIT_OUTPUT;
     // Tap rectangles are mostly well formed, so that points land inside them.
     for(let at=1;at<17;at++)frame.hitOutput[h+at]=number();
     if(next()<.9){frame.hitOutput[h+8]=next()*500;frame.hitOutput[h+9]=next()*800;frame.hitOutput[h+10]=20+next()*200;frame.hitOutput[h+11]=40+next()*300;}
     frame.hitOutput[h]=8192;
     referenceCopyTarget(entry,frame.hitOutput,h,entry.kind==='plant');
    });
   };
   layout();paint();
   for(let step=0;step<140;step++){
    const dice=next();now+=next()*90;
    if(dice<.12)layout();
    else if(dice<.3)paint();
    else if(dice<.8){
     // Mostly a point inside some entry's tap rectangle, as the page's frame has it.
     const origin={left:number(),top:number()},aim=entries[Math.floor(next()*entries.length)]?.tapRect;
     const clientX=next()<.05?number():(aim&&next()<.8?aim.left+next()*aim.width:next()*600)+(Number.isFinite(origin.left)?origin.left:0);
     const clientY=(aim&&next()<.9?aim.top+next()*aim.height:next()*900)+(Number.isFinite(origin.top)?origin.top:0);
     // What the host holds may have changed since the frame (the scene tells the arena first).
     if(next()<.2){const entry=entries[Math.floor(next()*entries.length)];if(entry?.model){entry.model.visible=!entry.model.visible;frame.hold(entries);}}
     const expected=referenceTap(entries,origin,clientX,clientY);
     let calls=0;const original=frame.lamp.tapNear;
     const node=liveTap({lamp:{tapNear:(...args)=>{calls++;return original.apply(frame.lamp,args);}}},entries,origin,clientX,clientY);
     expect(node,`session ${session} step ${step}`).toBe(expected);
     taps++;if(expected)found++;if(calls>1)asked++;
    }else{
     const oldRects=new Map(),stageRect={left:number(),top:number()};
     for(const entry of entries)if(next()<.7){
      const key=[entry.node?.dataset.objectId,entry.book?.id,entry.node?.dataset.bookId,entry.key].filter(value=>value!==undefined)[Math.floor(next()*2)]??entry.key;
      // Often about a pixel from where the button is now: the threshold itself.
      const target=entry.tapRect||entry.hitRect||entry.rect,near=()=>(next()<.5?1:-1)*[0,.25,.5,.75,1,1.25][Math.floor(next()*6)];
      oldRects.set(key,next()<.05?{}:target&&next()<.3?{left:target.left+stageRect.left+near(),top:target.top+stageRect.top+near()}:{left:number(),top:number()});
     }
     const pick=entries[Math.floor(next()*entries.length)],draggedKey=next()<.6&&pick?pick.node?.dataset.objectId??pick.key:next()<.5?undefined:null;
     frame.refresh();
     for(let index=0;index<entries.length;index++){const at=index*S;frame.state[at+5]=next()<.5?next():next()<.5?0:number();frame.state[at+21]=12345;frame.state[at+22]=-54321;
      for(let column=9;column<13;column++)frame.state[at+column]=7;}
     const lifts=entries.map((_,index)=>frame.state[index*S+5]),started=now;
     const expected=referenceReorder(entries,oldRects,stageRect,draggedKey,entry=>lifts[entry.row],started);
     liveReorder(frame,entries,oldRects,stageRect,draggedKey,started);
     frame.refresh();
     entries.forEach((entry,index)=>{
      const landing=expected.landing?.row===index?expected.landing.values:[7,7,7,7];
      for(let column=0;column<4;column++)expect(Object.is(frame.state[index*S+9+column],landing[column]),`session ${session} step ${step} landing ${index}`).toBe(true);
     });
     // The pose call writes what the release leaves of each item's offset: all of it at its start.
     scene.beginReorder(started);scene.beginFrame(started);
     scene.beginEntries(started,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
     motionFrame.prepare(entries,[],600,1000);
     const left=scene.reorderLeft;
     frame.poses(motionFrame.native,scene,roomMotion,roomTransition,started,false,room);
     const offsets=entries.map(()=>[12345,-54321]);
     for(let at=0;at<expected.items.length;at+=3)offsets[expected.items[at]]=[expected.items[at+1]*left,expected.items[at+2]*left];
     entries.forEach((entry,index)=>{
      expect(Object.is(frame.state[index*S+21],offsets[index][0])&&Object.is(frame.state[index*S+22],offsets[index][1]),`session ${session} step ${step} offset ${index}: ${frame.state[index*S+21]}, ${frame.state[index*S+22]} for ${offsets[index]}`).toBe(true);
      if(!entry.hitRect&&entry.rect&&offsets[index][0]!==12345)fallbacks++;
     });
     reorders++;eased+=expected.items.length/3;if(expected.landing)landings++;
     // The reorder ends before the next step.
     scene.beginFrame(started+1e6);frame.poses(motionFrame.native,scene,roomMotion,roomTransition,started+1e6,false,room);
    }
   }
  }finally{frame.free();scene.free();motionFrame.free();roomMotion.free();roomTransition.free();projection.free();}
 }
 expect(taps).toBeGreaterThan(3000);expect(found).toBeGreaterThan(700);expect(asked).toBeGreaterThan(40);
 expect(reorders).toBeGreaterThan(800);expect(eased).toBeGreaterThan(3000);expect(landings).toBeGreaterThan(50);expect(fallbacks).toBeGreaterThan(20);
});

it('reads a button\'s state in one call as the host did in up to four',()=>{
 const next=random(99),frame=createSceneEntryFrame(rust);
 try{
  const entries=Array.from({length:12},()=>({row:-1}));
  frame.bind(entries,true);
  const twins=entries.map(()=>({node:{className:'',disabled:false,style:{drag:['',''],pointerEvents:'',getPropertyValue(name){return this.drag[name==='--ihr-drag-x'?0:1];}}},
   classText:null,bits:0,dragX:'',dragY:'',dragNumberX:0,dragNumberY:0,stateText:''}));
  // The scene's own lines (src/js/bookshelf-scene.js stateFor).
  const live=twins.map(()=>({classText:null,bits:0,dragX:'',dragY:'',stateText:''}));
  const stateFor=(entry,node,row)=>{
   const classes=node.className,dragX=node.style.getPropertyValue('--ihr-drag-x'),dragY=node.style.getPropertyValue('--ihr-drag-y');
   const disabled=Boolean(node.disabled),pointerEvents=node.style.pointerEvents;
   if(classes===entry.classText&&dragX===entry.dragX&&dragY===entry.dragY&&disabled===entry.controlDisabled&&pointerEvents===entry.controlPointerEvents)return entry.stateText;
   entry.classText=classes;entry.dragX=dragX;entry.dragY=dragY;entry.controlDisabled=disabled;entry.controlPointerEvents=pointerEvents;
   entry.stateText=frame.lamp.domState(row,classes,dragX,dragY,disabled,pointerEvents);
   frame.refresh();entry.bits=frame.state[row*S+2];
   return entry.stateText;
  };
  let changed=0,seen=0;
  for(let step=0;step<30000;step++){
   const row=Math.floor(next()*twins.length),twin=twins[row],node=twin.node,dice=next();
   if(dice<.35){const words=[];for(let count=Math.floor(next()*5);count>0;count--)words.push(CLASSES[Math.floor(next()*CLASSES.length)]);node.className=words.join(next()<.1?'\t':next()<.1?'\n':' ');}
   else if(dice<.45)node.style.drag[Math.floor(next()*2)]=DRAGS[Math.floor(next()*DRAGS.length)];
   // A drag's own writes: a number of pixels, with all its figures or rounded, tiny, huge or zero.
   else if(dice<.6){const value=(next()-.5)*10**Math.floor(next()*12-4),places=Math.floor(next()*8);
    node.style.drag[Math.floor(next()*2)]=`${next()<.4?value:next()<.5?value.toFixed(places):next()<.5?Math.round(value):`${next()<.5?'-':''}${'0'.repeat(places)}${next()<.5?'.'+'0'.repeat(places+1):''}`}px`;}
   else if(dice<.7)node.disabled=!node.disabled;
   else if(dice<.8)node.style.pointerEvents=['','none','auto'][Math.floor(next()*3)];
   if(next()<.02)shelfWasm.memory.grow(1);
   const before=twin.stateText,expected=referenceStateFor(rust,twin),text=stateFor(live[row],node,row);
   expect(text,`step ${step}`).toBe(expected);frame.refresh();
   expect([live[row].bits,frame.state[row*S+3],frame.state[row*S+4]].map(value=>Object.is(value,-0)?'-0':String(value)),`step ${step}`)
    .toEqual([twin.bits,twin.dragNumberX,twin.dragNumberY].map(value=>Object.is(value,-0)?'-0':String(value)));
   if(expected!==before)changed++;
   seen|=twin.bits;
  }
  expect(changed).toBeGreaterThan(8000);expect(seen&79).toBe(79);
 }finally{frame.free();}
});
