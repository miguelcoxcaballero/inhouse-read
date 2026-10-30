import {expect,it,vi,afterEach} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import * as reference from './helpers/reference-scene-host.js';

// The shelf scene's recipes that moved to rust-ui/src/scene_host.rs, each run against its frozen
// JavaScript original (helpers/reference-scene-host.js) on equal inputs: the same numbers (Object.is,
// so -0 and NaN count), the same DOM, the same returned values and the same calls in the same order.
afterEach(()=>vi.restoreAllMocks());
const random=seed=>()=>((seed=Math.imul(seed^seed>>>15,2246822519)+1013904223|0)>>>0)/4294967296;
const bits=values=>Array.from(values,value=>Object.is(value,-0)?'-0':String(value));
const boxNumbers=box=>bits([box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z]);

function tree(next,depth=0){
 const object=next()<.3?new THREE.Group():new THREE.Mesh(next()<.15?new THREE.BufferGeometry():
  new THREE.BoxGeometry(1+next()*80,1+next()*60,1+next()*30),new THREE.MeshBasicMaterial());
 object.position.set((next()-.5)*400,(next()-.5)*300,next()<.1?-0:(next()-.5)*90);
 object.rotation.set((next()-.5)*.6,(next()-.5)*3,(next()-.5)*.4,next()<.5?'XYZ':'ZYX');
 object.scale.set(next()<.1?-1.25:.5+next(),.5+next()*1.5,next()<.05?0:.75+next()*.5);
 if(depth<3)for(let index=0,count=Math.floor(next()*4);index<count;index++)object.add(tree(next,depth+1));
 return object;
}
it('measures the cabinet bounds with three\'s own operation order',()=>{
 for(let seed=1;seed<=60;seed++){
  const cabinet=tree(random(seed));
  const expected=reference.localBounds(cabinet.clone(true)),native=rust.scene_local_bounds(cabinet.clone(true));
  expect(bits(native)).toEqual(boxNumbers(expected));
 }
 expect(bits(rust.scene_local_bounds(new THREE.Group()))).toEqual(boxNumbers(new THREE.Box3()));
});

function bin(seed){
 const next=random(seed),group=new THREE.Group(),lid=new THREE.Mesh(new THREE.BoxGeometry(30,2,30),new THREE.MeshBasicMaterial());
 group.add(new THREE.Mesh(new THREE.CylinderGeometry(14,12,40,12),new THREE.MeshBasicMaterial()),lid);
 const states=[];
 group.userData={openness:[undefined,null,'0.4',.7,NaN,-0,1][seed%7],setState(state){states.push({...state});lid.rotation.x=-(state.openness??0)*1.6;lid.position.y=20+(state.openness??0)*4;}};
 group.position.set(next()*90,-next()*40,next()*20);group.rotation.set(0,next()*2,0);group.scale.setScalar(.5+next());
 return {group,states};
}
it('reserves the bin\'s footprint through the lid\'s sweep and puts its pose back',()=>{
 for(let seed=0;seed<21;seed++){
  const a=bin(seed),b=bin(seed);
  const expected=reference.trashFootprint(a.group),bounds=new THREE.Box3();
  const native=rust.scene_trash_footprint(b.group,bounds,()=>new THREE.Box3());
  expect(native).toBe(bounds);expect(boxNumbers(native)).toEqual(boxNumbers(expected));
  expect(b.states).toEqual(a.states);
  for(const key of ['position','rotation','scale'])expect(b.group[key].toArray()).toEqual(a.group[key].toArray());
  expect(b.group.matrixWorld.elements).toEqual(a.group.matrixWorld.elements);
 }
});

it('builds the entries\' keys, compares their placements and takes the painted poses as before',()=>{
 const next=random(7),ids=[undefined,null,'',0,-0,7,'book-é\u{1F4D6}','\uD800x',NaN];
 const pick=list=>list[Math.floor(next()*list.length)];
 const entries=Array.from({length:240},(_,index)=>{
  const node=next()<.8?document.createElement('button'):next()<.5?null:undefined;
  if(node&&next()<.6)node.dataset.objectId=String(pick(ids));if(node&&next()<.5)node.dataset.bookId=String(pick(ids));
  const book=next()<.8?{id:pick(ids),path:pick(ids),title:pick(ids),driveFileId:next()<.5?`d${index%9}`:undefined,
   shelfPosition:next()<.2?undefined:{x:Math.floor(next()*3)/2,unit:next()<.5?0:-0}}:undefined;
  const pose=new THREE.Object3D();pose.position.set((next()-.5)*500,next()<.1?-0:next()*300,(next()-.5)*40);
  pose.quaternion.setFromEuler(new THREE.Euler(next(),next(),next()));pose.scale.setScalar(next()<.1?-0:1+next());
  return {kind:pick(['plant','lamp','book',undefined,'plant']),key:pick([undefined,null,`k${index}`]),node,book,shelf:pick([0,1,'1',undefined]),pose};
 });
 for(const [index,entry] of entries.entries())for(const at of [index,0,3.5])expect(rust.scene_entry_key(entry,at)).toBe(reference.entryKey(entry,at));
 const motionKey=entry=>entry.kind==='plant'||entry.kind==='lamp'?entry.key:entry.book?.driveFileId?`book:drive:${entry.book.driveFileId}`:null;
 for(const width of [390,-0,1234.5])for(const ppm of [1000/600*390,3,-2]){
  const native=rust.scene_painted_poses(entries,motionKey,width,ppm),expected=reference.paintedPoses(entries,motionKey,width,ppm);
  expect(native.map(row=>[row[0],...bits(row.slice(1))])).toEqual(expected.map(row=>[row[0],...bits(row.slice(1))]));
 }
 let same=0;
 for(let seed=0;seed<120;seed++){
  const next=random(seed+100),list=entries.slice(seed,seed+2+seed%9);
  const old=new Map(list.map((entry,index)=>[reference.entryKey(entry,index),{...entry,shelf:next()<.9?entry.shelf:2,
   book:entry.book&&next()<.85?{...entry.book,shelfPosition:next()<.8?entry.book.shelfPosition&&{...entry.book.shelfPosition}:{x:9}}:next()<.5?undefined:entry.book}]));
  if(next()<.2)old.delete([...old.keys()][0]);
  const expected=reference.samePlacements(old,list);same+=expected;
  expect(rust.scene_same_placements(old,list)).toBe(Boolean(expected));
 }
 expect(same).toBeGreaterThan(0);expect(same).toBeLessThan(120);
});

function foliage(i){
 const host=document.createElement('button');
 host.innerHTML=`<svg class="leaf" data-n="${i}"><defs><clipPath id="c${i}"><path d="M${i} 0Z"></path></clipPath></defs>${i%3?`<path d="M0 ${i}L1 1Z"></path>`:''}<g><path d="M9 9Z"></path></g></svg>`;
 const svg=host.firstChild;
 return {host,native:{state:{free(){}},cache:[i],svg,path:svg.querySelector(':scope > path'),exclusions:svg.querySelector('clipPath path'),key:`f${i}`}};
}
it('moves a retained plant\'s touch surface to its new button',()=>{
 for(let i=0;i<9;i++){
  const a=foliage(i),b=foliage(i),[nodeA,nodeB]=[document.createElement('button'),document.createElement('button')];
  const expected=reference.rebindFoliage(a.native,nodeA),native=rust.scene_rebind_foliage(b.native,nodeB);
  expect(Object.keys(native)).toEqual(Object.keys(expected));
  expect(nodeB.outerHTML).toBe(nodeA.outerHTML);expect(b.host.outerHTML).toBe(a.host.outerHTML);
  expect(native.svg.parentNode).toBe(nodeB);expect(native.path===null).toBe(expected.path===null);
  if(native.path)expect(native.svg.contains(native.path)).toBe(true);
  expect(native.exclusions?.outerHTML).toBe(expected.exclusions?.outerHTML);expect(native.cache).toBe(b.native.cache);
 }
});

function dropCase(seed,log){
 const next=random(seed+300),furniture=new THREE.Group(),parent=new THREE.Group();
 const model=next()<.85?new THREE.Object3D():null;
 if(model){parent.add(model);model.visible=next()<.5;model.position.set(next(),next(),next());}
 const pose=new THREE.Object3D();pose.position.set(next()*9,-0,next());pose.quaternion.setFromEuler(new THREE.Euler(next(),0,next()));pose.scale.setScalar(next()+.5);
 const node=next()<.8?document.createElement('button'):null;if(node&&next()<.5)node.className='ihr-spine is-away';
 const drop={settled:next()<.3,resolve:value=>log.push(['resolve',value])};
 const data=element=>{for(const key of ['trashDropProgress','dropProgress','trashingBookId','trashingObjectId','trashingObjectKind','other'])element.dataset[key]='1';return element;};
 return {entry:{model,pose,node,trashDrop:drop},drop,furniture,trashNode:next()<.7?data(document.createElement('button')):null,canvas:data(document.createElement('canvas'))};
}
it('cancels a drop into the bin exactly as before',()=>{
 for(let seed=0;seed<60;seed++)for(const restore of [true,false]){
  const logs=[[],[]],a=dropCase(seed,logs[0]),b=dropCase(seed,logs[1]);
  const expected=reference.cancelTrashDrop(a.entry,restore,a.furniture,a.trashNode,a.canvas);
  expect(rust.scene_cancel_trash_drop(b.entry,restore,b.furniture,b.trashNode,b.canvas)).toBe(expected);
  expect(logs[1]).toEqual(logs[0]);expect(b.drop.settled).toBe(a.drop.settled);expect(b.entry.trashDrop).toBe(null);
  expect(b.canvas.outerHTML).toBe(a.canvas.outerHTML);expect(b.trashNode?.outerHTML).toBe(a.trashNode?.outerHTML);
  if(a.entry.model){
   expect(b.entry.model.parent===b.furniture).toBe(a.entry.model.parent===a.furniture);expect(b.entry.model.visible).toBe(a.entry.model.visible);
   for(const key of ['position','quaternion','scale'])expect(bits(b.entry.model[key].toArray())).toEqual(bits(a.entry.model[key].toArray()));
  }
 }
});

function plant(seed){
 const next=random(seed+500),model=new THREE.Group();
 model.userData.catalogId=[undefined,'monstera',7][seed%3];
 model.add(new THREE.Mesh(new THREE.BoxGeometry(10,20,1+next()*40),new THREE.MeshBasicMaterial()));
 if(seed%5){
  const material=new THREE.MeshBasicMaterial();
  material.map=[undefined,null,new THREE.DataTexture(),new THREE.Texture(),0][seed%5];
  material.alphaTest=[0,-0,.5,undefined][seed%4];material.alphaToCoverage=seed%7===2;
  const leaf=new THREE.Mesh(new THREE.BoxGeometry(5,5,next()*9),material);leaf.name='leaf-0';leaf.position.z=next()*20;model.add(leaf);
 }
 return model;
}
it('labels a plant button with its model diagnostics',()=>{
 for(let seed=0;seed<40;seed++){
  const [a,b]=[plant(seed),plant(seed)],[nodeA,nodeB]=[document.createElement('button'),document.createElement('button')];
  nodeA.dataset.plantModelDepth=nodeB.dataset.plantModelDepth='old';
  reference.plantDiagnostics(a,nodeA);
  rust.scene_plant_diagnostics(b,nodeB,new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3()).z);
  expect(nodeB.outerHTML).toBe(nodeA.outerHTML);
  expect(Object.entries(b.userData.shelfPlantDiagnostics)).toEqual(Object.entries(a.userData.shelfPlantDiagnostics));
 }
});

function restEntries(seed,log){
 const next=random(seed+700),count=1+seed%6;
 return Array.from({length:count},(_,index)=>{
  const node=next()<.85?document.createElement('button'):undefined;
  if(node)node.className=['ihr-spine','ihr-spine is-pressed','ihr-spine is-pressed is-press-pending','is-lifted','is-dragging',''][Math.floor(next()*6)%(next()<.6?1:6)];
  const lift=()=>[0,-0,.22,.220001,.2200011,1,NaN,undefined,''][Math.floor(next()*9)%(next()<.7?2:9)];
  const entry={node,lift:{value:lift(),from:lift(),target:lift()},preview:{active:next()<.08},
   insertion:next()<.05?{}:null,trashDrop:next()<.04?{}:undefined,landing:next()<.05?{}:null};
  if(next()<.3)entry.lampTint={moving(){log.push(['tint',index]);return next()<.2;}};
  if(next()<.3){const target=next()<.5?1:0;entry.lampPower={value:next()<.7?target:.5,from:next()<.6?target:1-target,target,started:next()*100,duration:next()<.5?0:220};}
  return entry;
 });
}
it('decides whether the room is at rest for an inspection or a modal as before',()=>{
 const seen=new Set();
 for(let seed=0;seed<400;seed++)for(const now of [0,150,400]){
  const logs=[[],[]],[a,b]=[restEntries(seed,logs[0]),restEntries(seed,logs[1])];
  const expected=reference.inspectionRest(a,now);seen.add(`i${expected}`);
  expect(rust.scene_inspection_rest(b,now)).toBe(expected);expect(logs[1]).toEqual(logs[0]);
  for(const selected of [null,0,a.length-1]){
   const modal=reference.modalRest(a,selected===null?null:a[selected],now);seen.add(`m${modal}`);
   expect(rust.scene_modal_rest(b,selected===null?null:b[selected],now)).toBe(modal);expect(logs[1]).toEqual(logs[0]);
  }
 }
 expect([...seen].sort()).toEqual(['i0','i1','i2','mfalse','mtrue']);
});

it('paints the veneer swatch, tints the wood and hides the bin\'s button as before',()=>{
 const log=[];
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){
  log.push(['context',kind,this.width,this.height]);
  return this.dataset.none?null:{set fillStyle(value){log.push(['fill',value]);},fillRect(...args){log.push(['rect',...args]);}};
 });
 for(const mean of ['#71553f','#759380']){
  const [a,b]=[{},{}];
  reference.veneerSwatch(a,mean);const expected=log.splice(0);
  rust.scene_veneer_swatch(b,mean);
  expect(log.splice(0)).toEqual(expected);expect(b.needsUpdate).toBe(true);
  expect([b.image.width,b.image.height,b.image.outerHTML]).toEqual([a.image.width,a.image.height,a.image.outerHTML]);
 }
 const material=(side,name)=>({opacity:.5,color:{set(value){side.push([name,value]);}}});
 for(const dark of [true,false]){
  const sides=[[],[]],[a,b]=sides.map(side=>['wood','back','trim','occlusion','wall'].map(name=>material(side,name)));
  reference.woodTheme(dark,...a);rust.scene_wood_theme(dark,...b);
  expect(sides[1]).toEqual(sides[0]);expect(b[3].opacity).toBe(a[3].opacity);
 }
 for(let i=0;i<4;i++){
  const [a,b]=[document.createElement('button'),document.createElement('button')];
  for(const node of [a,b]){if(i%2)node.setAttribute('style','left: 3px; pointer-events: auto;');if(i>1){node.tabIndex=0;node.setAttribute('aria-hidden','false');}}
  reference.hideTrashNode(a);rust.scene_hide_trash_node(b);
  expect(b.outerHTML).toBe(a.outerHTML);expect([b.hidden,b.inert,b.tabIndex]).toEqual([a.hidden,a.inert,a.tabIndex]);
 }
});
