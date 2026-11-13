// The scene's canvas diagnostics per frame: about seventy `data-*` values, almost all unchanged
// from one frame to the next. `previous` asks the element for each (`setData`: read, compare,
// write when different); `current` keeps what the scene last wrote and asks the element only for
// a value that changed (bookshelf-scene.js showData). Two stand-ins for the element: a plain
// object (reads cost almost nothing: the floor of the gain) and jsdom's canvas (its dataset walks
// the attributes, as a browser's does, but far more slowly than one: not a browser figure).
// Node, no browser. Interleaved rounds, medians.
// node scripts/benchmark-scene-diagnostics.mjs
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const KEYS=['shelfView','viewProgress','yaw','pitch','zoom','inspectionZoom','inspectionMoving','inspectionPan','cabinetWidth','trashReserve','shelfType','shelfUnits','shelfDimensions',
 'sceneFitHeight','floorVisible','fullCabinetInFrame','catalog3d','catalogVisible','activeBooks','previewAnimating','previewObjects','returningBooks','returningBookId','returnRenderer',
 'trash3d','trashHover','trashVisible','trashViewHidden','trashLocalPosition','trashLocalScale','trashLocalRotation','trashFootY','cabinetFloorY','trashCameraInFrame','trashFootWorld',
 'floorContactWorld','snapshotRenderCount','sceneDrawCalls','renderCount','activePlants','highResolutionPlants','activeLamps','lampLightCount','activeLampLights','lampShadowCount',
 'lampLightTemperature','overviewBooks','highResolutionBooks','bookTextureResolutions','sceneGeometries','sceneTextures','scenePrograms','inspectionOverviewReady','pixelRatio',
 'detailedBooks','bookQualityPending','shadowMapSize','furnitureMeshes','plantGeometry','animating','nativeRoomPresentation','inspectionCacheActive','inspectionCacheMissReason'];
// Per frame: the render counters move; in a `moving` frame the view's numbers do too.
const values=(tick,moving)=>KEYS.map((key,index)=>key==='renderCount'||key==='snapshotRenderCount'?String(tick):moving&&index<8?(tick*.0001+index).toFixed(4):`value ${index}`);
function setData(element,key,value){if(element.dataset[key]!==value)element.dataset[key]=value;}
function shadowed(element){
 const shownData=new Map();
 return (key,value)=>{if(shownData.get(key)===value)return;shownData.set(key,value);setData(element,key,value);};
}
const elements=[['plain object',()=>({dataset:{}})]];
try{const {JSDOM}=await import('jsdom');const {document}=new JSDOM('').window;elements.push(['jsdom canvas',()=>document.createElement('canvas')]);}catch{}
for(const [name,make] of elements)for(const mode of ['steady','moving']){
 const a=make(),b=make(),showData=shadowed(b),moving=mode==='moving',frames=Array.from({length:64},(_,tick)=>values(tick,moving));
 const previous=tick=>{const row=frames[tick&63];for(let i=0;i<KEYS.length;i++)setData(a,KEYS[i],row[i]);};
 const current=tick=>{const row=frames[tick&63];for(let i=0;i<KEYS.length;i++)showData(KEYS[i],row[i]);};
 for(let tick=0;tick<200;tick++){previous(tick);current(tick);assert.deepEqual({...b.dataset},{...a.dataset});}
 const loops=name==='plain object'?2000:60;let oldTick=200,newTick=200;
 const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)previous(oldTick++);return(performance.now()-start)/loops;};
 const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)current(newTick++);return(performance.now()-start)/loops;};
 const old=[],now=[];
 for(let round=0;round<21;round++){if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
 results.push({element:name,mode,keys:KEYS.length,askEveryValueMs:+median(old).toFixed(5),rememberedMs:+median(now).toFixed(5),speedup:+(median(old)/median(now)).toFixed(2)});
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'canvas diagnostics per frame, Node',results},null,1));
