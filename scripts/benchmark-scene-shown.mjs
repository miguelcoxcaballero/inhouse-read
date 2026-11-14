// The view's and the bin's diagnostics per frame, texts and writes together. `previous` is the
// frozen JavaScript of bookshelf-scene.js 1.7.333: RustScene#transformFresh and #trashTexts hand
// over their texts when a number moved, and every frame compares each of the 16 + 28 values with
// the one last written (a Map per target) before writing it to the data. `current`:
// RustScene#transformShown and #trashShown compare the numbers and write only the texts that
// differ; the host keeps the four the finger-following image also writes. The targets are plain
// objects (no DOM: a real dataset costs the same on both sides, per write). Both targets are
// asserted equal after every frame first. Node/WASM. Interleaved rounds, medians.
// node scripts/benchmark-scene-shown.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const bin=new Float64Array([-40,0,-40,40,140,40,700,-1100,60]);
const setData=(data,key,value)=>{if(data[key]!==value)data[key]=value;};
for(const mode of ['steady','inspecting','all moving']){
 const make=()=>{const scene=new rust.RustScene(600,1200,600,250,false,true,0);scene.measureFit(844,60,760,60,0,false);return scene;};
 const o=make(),n=make(),out=new Float64Array(8),packed=new Float64Array(17);
 const oldCanvas={},oldBin={},newCanvas={},newBin={};
 n.shows(newCanvas);n.binShows(newBin);n.labels('walnut','600 x 250 x 1160 mm');
 const shownData=new Map(),binShown=new Map(),newShown=new Map();
 const showData=(key,value)=>{if(shownData.get(key)===value)return;shownData.set(key,value);setData(oldCanvas,key,value);};
 const binData=(key,value)=>{if(binShown.get(key)!==value){binShown.set(key,value);setData(oldBin,key,value);}};
 const trashData=(key,value)=>{binData(key,value);showData(key,value);};
 const showNew=(key,value)=>{if(newShown.get(key)===value)return;newShown.set(key,value);setData(newCanvas,key,value);};
 let viewTexts=null,trashTexts=null,heldTexts=null;
 const numbers=tick=>{const wobble=mode==='all moving'?tick*.001:0;return [700.5+wobble,-1100.25,60,.8,0,.3,0,-1100.25,-1100,650.123+wobble,900.5,30,650.1+wobble,901,30,44,140];};
 const view=(scene,tick)=>{if(mode!=='steady')scene.setInspection(1.5+Math.sin(tick*.05)*.4,Math.sin(tick*.03)*20,5,true);};
 const shelfType='walnut',dimensions='600 x 250 x 1160 mm';
 const previous=tick=>{view(o,tick);const v=numbers(tick),visible=tick%97!==0,viewHidden=o.trashViewHidden(),inFrame=true;
  const texts=viewTexts=o.transformFresh(bin,-Infinity,true,1,out)||viewTexts;
  showData('shelfView',texts[0]);showData('viewProgress',texts[1]);showData('yaw',texts[2]);showData('pitch',texts[3]);showData('zoom',texts[4]);
  showData('inspectionZoom',texts[5]);showData('inspectionMoving',texts[6]);showData('inspectionPan',texts[7]);
  showData('cabinetWidth',texts[8]);showData('trashReserve',texts[9]);showData('shelfType',shelfType);showData('shelfUnits',texts[10]);
  showData('shelfDimensions',dimensions);showData('sceneFitHeight',texts[11]);showData('floorVisible',texts[12]);showData('fullCabinetInFrame',texts[13]);
  const hover=String(o.trashHover);
  binData('trash3d','true');binData('trashVisible',String(visible));binData('trashViewHidden',String(viewHidden));binData('trashHover',hover);binData('hover',hover);
  showData('trash3d','true');showData('trashHover',hover);showData('trashVisible',String(visible));showData('trashViewHidden',String(viewHidden));
  for(let i=0;i<17;i++)packed[i]=v[i];
  const t=trashTexts=o.trashTexts(packed)||trashTexts;
  trashData('trashLocalPosition',t[0]);trashData('trashLocalScale',t[1]);trashData('trashLocalRotation',t[2]);trashData('trashFootY',t[3]);
  trashData('cabinetFloorY',t[4]);trashData('trashCameraInFrame',String(inFrame));trashData('trashFootWorld',t[5]);trashData('floorContactWorld',t[6]);
  trashData('trashRadius',t[7]);trashData('trashHeight',t[8]);};
 const current=tick=>{view(n,tick);const v=numbers(tick),visible=tick%97!==0;
  const texts=heldTexts=n.transformShown(bin,-Infinity,true,1,out)||heldTexts;
  showNew('zoom',texts[0]);showNew('inspectionZoom',texts[1]);showNew('inspectionMoving',texts[2]);showNew('inspectionPan',texts[3]);
  for(let i=0;i<17;i++)packed[i]=v[i];
  n.trashShown(packed,visible,true);};
 try{
  let clock=0;
  for(;clock<300;clock++){previous(clock);current(clock);assert.deepEqual(newCanvas,oldCanvas);assert.deepEqual(newBin,oldBin);
   assert.deepEqual(Object.keys(newCanvas),Object.keys(oldCanvas));assert.deepEqual(Object.keys(newBin),Object.keys(oldBin));}
  const loops=400;let oldTick=clock,newTick=clock;
  const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)previous(oldTick++);return(performance.now()-start)/loops;};
  const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)current(newTick++);return(performance.now()-start)/loops;};
  const old=[],now=[];
  for(let round=0;round<21;round++){if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
  results.push({mode,javascriptUs:+(median(old)*1000).toFixed(3),rustUs:+(median(now)*1000).toFixed(3),speedup:+(median(old)/median(now)).toFixed(2)});
 }finally{o.free();n.free();}
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'view fit plus the view\'s and the bin\'s diagnostics written to plain objects, per frame, Node/WASM',results},null,1));
