// How a painted frame ends, per frame. `previous` is the frozen JavaScript of draw() and
// updateEntries() in 1.7.333: the view's `turning`, `reordering` and `moving` are asked twelve
// times (each a native getter) for the canvas' `animating`, the two moving flags, the room's
// quiet and the next frame, and the entries' three diagnostics are formatted and compared with a
// Map. `current`: RustScene#framePlan answers all of it in one call and
// RustSceneEntryFrame#showEntries writes the three when their numbers change. The results are
// asserted equal first. Node/WASM, plain objects as targets. Interleaved rounds, medians.
// node scripts/benchmark-scene-frame-end.mjs
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const setData=(data,key,value)=>{if(data[key]!==value)data[key]=value;};
for(const mode of ['at rest','a book moves','inspecting']){
 const sceneView=new rust.RustScene(600,1200,600,250,false,true,0),frame=new rust.RustSceneEntryFrame();
 if(mode==='inspecting')sceneView.setInspection(1.5,3,4,true);
 const oldCanvas={},newCanvas={},shownData=new Map(),newShown=new Map();
 frame.shows(newCanvas);
 const showData=(key,value)=>{if(shownData.get(key)===value)return;shownData.set(key,value);setData(oldCanvas,key,value);};
 const showNew=(key,value)=>{if(newShown.get(key)===value)return;newShown.set(key,value);setData(newCanvas,key,value);};
 const lighting={settling:false};
 let sink=0,lastSceneMoving=false,lastLocalSceneMoving=false;
 const inputs=tick=>{const moving=mode==='a book moves',summary=moving?1+8*(tick%3):0;return {moving,trashMoving:false,localMoving:moving,busy:moving,summary,activeBooks:120};};
 const previous=tick=>{const {moving,trashMoving,localMoving,busy,summary,activeBooks}=inputs(tick);
  const previewing=Boolean(summary&4),previewed=Math.floor(summary/8);
  showData('activeBooks',String(activeBooks));showData('previewAnimating',String(previewing));showData('previewObjects',String(previewed));
  showData('animating',String(Boolean(sceneView.turning||sceneView.reordering||moving||trashMoving||sceneView.moving)));
  lastSceneMoving=Boolean(sceneView.turning||sceneView.reordering||moving||trashMoving);
  lastLocalSceneMoving=Boolean(sceneView.turning||sceneView.reordering||localMoving||trashMoving);
  const quiet=!lastSceneMoving&&!sceneView.moving&&!busy;
  const again=sceneView.turning||sceneView.reordering||moving||trashMoving||(lighting.settling&&!sceneView.moving);
  return (lastSceneMoving?1:0)|(lastLocalSceneMoving?2:0)|(quiet?4:0)|(again?8:0);};
 const current=tick=>{const {moving,trashMoving,localMoving,busy,summary,activeBooks}=inputs(tick);
  frame.showEntries(activeBooks,summary);
  const plan=sceneView.framePlan((moving?1:0)|(trashMoving?2:0)|(localMoving?4:0)|(busy?8:0));
  showNew('animating',String(Boolean(plan&1)));
  lastSceneMoving=Boolean(plan&2);lastLocalSceneMoving=Boolean(plan&4);
  const quiet=Boolean(plan&8),again=plan&2||lighting.settling&&!(plan&16);
  return (lastSceneMoving?1:0)|(lastLocalSceneMoving?2:0)|(quiet?4:0)|(again?8:0);};
 for(let tick=0;tick<200;tick++){assert.equal(current(tick),previous(tick));
  assert.deepEqual(Object.fromEntries(Object.entries(newCanvas).map(([k,v])=>[k,String(v)])),oldCanvas);}
 const loops=5000;let a=0,b=0;
 const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)sink+=previous(a++);return(performance.now()-start)/loops*1e6;};
 const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)sink+=current(b++);return(performance.now()-start)/loops*1e6;};
 for(let i=0;i<5;i++){timeOld();timeNew();}
 const old=[],now=[];
 for(let round=0;round<21;round++){if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
 results.push({mode,javascriptNs:+median(old).toFixed(1),rustNs:+median(now).toFixed(1),speedup:+(median(old)/median(now)).toFixed(2),sink:Number.isFinite(sink)});
 sceneView.free();frame.free();
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'the end of a painted frame: moving flags, quiet, next frame and the entries\' three diagnostics, Node/WASM',results},null,1));
