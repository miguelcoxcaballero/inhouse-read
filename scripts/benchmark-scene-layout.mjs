// The frame's layout numbers: the frozen host sequence of 1.7.334 (bookshelf-scene.js viewport(),
// updateCatalog() and updateTrash(): sizeViewport, framePixels, the view's height read from the
// view six times, scrollOf, then catalogFrame and trashFrame each given the stage, the clip and the
// window packed again) against the layout given once (rust-ui/src/scene_layout.rs: frameLayout,
// catalogPlaced, trashPlaced; sizeViewport's six numbers). Node/WASM, no DOM or GPU.
// Interleaved rounds, medians.  node scripts/benchmark-scene-layout.mjs [dir with the shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const scene=new rust.RustScene(390,700,390,162.5,false,true,0);
scene.measureFit(844,60,760,60,0,false);
const layout={canvas:{top:60},stage:{left:0,top:60},scroller:{left:0,top:60,right:390,bottom:760},innerWidth:390,innerHeight:844,visualBottom:844};
// A plain array, as three's Matrix4#elements is.
const matrix=[.8,0,-.5,0, .1,.9,.2,0, .5,-.2,.8,0, 230,-140,-80,1];
const catalogBox=Float64Array.of(-38,-54,-1.7,38,54,1.7),catalogCover=Float64Array.of(76,108,3.4),trashPacked=Float64Array.of(300,360,500,640,60,140);
const viewSizes=new Float64Array(4),viewPixels=new Float64Array(2),six=new Float64Array(6),catalogOut=new Float64Array(6),trashOut=new Float64Array(6);
const catalogStage=new Float64Array(2),scrollerClip=new Float64Array(4),catalogInner=new Float64Array(2);
let sink=0,text='';
function frozen(){
 scene.sizeViewport(700,844,2,viewSizes);
 const ratio=viewSizes[1];
 scene.framePixels(ratio,viewPixels);
 // The canvas' height (compared, and the camera's bottom) and the two lightings' viewport.
 sink+=scene.viewportHeight+scene.viewportHeight+scene.viewportHeight+scene.viewportHeight+viewPixels[0]+viewPixels[1];
 const scroll=scene.scrollOf(layout.canvas.top,layout.stage.top);
 const stageBounds=layout.stage,clip=layout.scroller;
 catalogStage[0]=stageBounds.left;catalogStage[1]=stageBounds.top;
 scrollerClip[0]=clip.left;scrollerClip[1]=clip.top;scrollerClip[2]=clip.right;scrollerClip[3]=clip.bottom;
 catalogInner[0]=layout.innerWidth;catalogInner[1]=layout.innerHeight;
 const face=scene.catalogFrame(catalogBox,matrix,catalogCover,scroll,catalogStage,scrollerClip,catalogInner,catalogOut);
 scrollerClip[0]=clip.left;scrollerClip[1]=clip.top;scrollerClip[2]=clip.right;scrollerClip[3]=clip.bottom;
 scene.trashFrame(trashPacked,scroll,stageBounds.left,stageBounds.top,scrollerClip,layout.innerWidth,layout.innerHeight,layout.visualBottom,trashOut);
 return [face,scroll,ratio,...catalogOut,...trashOut];
}
function placed(){
 scene.sizeViewport(700,844,2,six);
 const viewportHeight=six[0],ratio=six[1];
 sink+=viewportHeight+viewportHeight+viewportHeight+viewportHeight+six[4]+six[5];
 const stage=layout.stage,clip=layout.scroller;
 const scroll=scene.frameLayout(layout.canvas.top,stage.left,stage.top,clip.left,clip.top,clip.right,clip.bottom,layout.innerWidth,layout.innerHeight,layout.visualBottom);
 const face=text=scene.catalogPlaced(catalogBox,matrix,catalogCover,catalogOut)??text;
 scene.trashPlaced(trashPacked,trashOut);
 return [face,scroll,ratio,...catalogOut,...trashOut];
}
assert.deepEqual(placed(),frozen());assert.deepEqual(placed(),frozen());
for(const moving of [false,true]){
 const runs={frozen,placed},rounds=41,frames=4000,times={frozen:[],placed:[]};
 const frame=(run,index)=>{if(moving){matrix[12]=230+index%97*.37;layout.canvas.top=60+index%53;}sink+=run().length;};
 for(let warm=0;warm<4000;warm++){frame(frozen,warm);frame(placed,warm);}
 for(let round=0;round<rounds;round++)for(const name of round%2?['frozen','placed']:['placed','frozen']){
  const started=performance.now();
  for(let index=0;index<frames;index++)frame(runs[name],index);
  times[name].push((performance.now()-started)/frames*1000);
 }
 console.log((moving?'a frame that scrolls and moves the booklet':'a frame at rest').padEnd(44),`frozen ${median(times.frozen).toFixed(3)} us   layout given once ${median(times.placed).toFixed(3)} us`,sink?'':'');
}
// The view's states a frame asks for: frozen, one property at a time (draw, updateTrash and the painted
// view of 1.7.334); now beginFrame, trashBegin, takeRefit and keepPainted (rust-ui/src/scene_begin.rs).
{
 let painted=null;
 const states=now=>{
  const furnitureMoving=scene.turning||scene.reordering;
  let scrollPan=null;
  if(scene.turning)scrollPan=scene.stepTurn(now);
  if(scene.reordering){sink+=scene.stepReorder(now);if(!scene.reordering)sink++;}
  if(scrollPan!==null)sink+=scrollPan;else if(scene.progress===1)sink++;
  const hidden=scene.trashViewHidden();
  if(hidden)scene.trashReset();
  const moving=scene.trashStep(now,false);
  const refit=scene.shadowRefit&&!scene.moving;
  if(!scene.moving)scene.shadowRefit=false;
  painted={progress:scene.progress,inspectionZoom:scene.zoom,panX:scene.panX,panY:scene.panY};
  return (furnitureMoving?1:0)+(hidden?2:0)+(moving?4:0)+(refit?8:0);
 };
 const begun=now=>{
  const begun=scene.beginFrame(now),furnitureMoving=Boolean(begun&3);
  if(begun&1)sink+=scene.turnScroll;
  if(begun&2){sink+=scene.reorderLeft;if(begun&4)sink++;}
  if(begun&1)sink+=scene.turnScroll;else if(begun&8)sink++;
  const bin=scene.trashBegin(now,false);
  const refit=scene.takeRefit();
  scene.keepPainted();
  return (furnitureMoving?1:0)+(bin&1?2:0)+(bin>1?4:0)+(refit?8:0);
 };
 assert.equal(begun(1),states(1));
 const runs={states,begun},rounds=41,frames=20000,times={states:[],begun:[]};
 for(let warm=0;warm<20000;warm++){sink+=states(warm)+begun(warm);}
 for(let round=0;round<rounds;round++)for(const name of round%2?['states','begun']:['begun','states']){
  const started=performance.now();
  for(let index=0;index<frames;index++)sink+=runs[name](index);
  times[name].push((performance.now()-started)/frames*1000);
 }
 console.log('the view\'s states of a frame at rest'.padEnd(44),`frozen ${median(times.states).toFixed(3)} us   one call each ${median(times.begun).toFixed(3)} us`,sink&&painted?'':'');
}
scene.free();
