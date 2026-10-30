import {expect,it,vi,afterEach} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import * as reference from './helpers/reference-scene-host.js';
import {bookmarkFor} from '../../src/js/bookshelf-layout.js';

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

function adoption(seed,log){
 const next=random(seed+900),count=1+seed%7,byNode=new Map(),host=document.createElement('div');
 document.body.append(host);
 const entries=Array.from({length:count},(_,index)=>{
  const kind=next()<.2?(next()<.5?'plant':'lamp'):undefined,node=next()<.95?document.createElement('button'):null;
  if(node&&next()<.95)host.append(node);
  const book=kind?undefined:{id:next()<.08?'dup':next()<.05?undefined:`b${index}`,title:`t${index}`};
  const entry={kind,node,book,state:`s${index}`,preview:{active:next()<.03},landing:next()<.03?{}:null,replacement:next()<.03?{}:undefined,
   plantQuality:null,insertion:next()<.02?{}:null,trashDrop:null};
  if(node&&next()<.95)byNode.set(node,next()<.97?entry:{});
  return entry;
 });
 const books=entries.filter(entry=>entry.book);
 const previous=books.map(entry=>next()<.97?entry.book:{...entry.book});
 const records=next()<.05?{length:books.length}:books.map(entry=>({...entry.book,title:`new ${entry.book.title}`}));
 if(next()<.05&&Array.isArray(records))records.pop();
 const stateFor=entry=>{log.push(['state',entry.state]);return next()<.97?entry.state:'moved';};
 const canAdopt=(before,after)=>{log.push(['can',before.length,after.length]);return next()<.95;};
 return {entries,previous,records,byNode,stateFor,canAdopt,host};
}
it('adopts saved metadata records under the same conditions and assigns them all at once',()=>{
 let adopted=0;
 for(let seed=0;seed<300;seed++){
  const logs=[[],[]],[a,b]=[adoption(seed,logs[0]),adoption(seed,logs[1])];
  const expected=reference.adoptRecords(a.entries,a.previous,a.records,a.byNode,a.stateFor,a.canAdopt);adopted+=expected;
  expect(rust.scene_adopt_records(b.entries,b.previous,b.records,b.byNode,b.stateFor,b.canAdopt)).toBe(expected);
  expect(logs[1]).toEqual(logs[0]);
  expect(b.entries.map(entry=>entry.book&&[entry.book.id,entry.book.title,b.records.indexOf?.(entry.book)])).toEqual(a.entries.map(entry=>entry.book&&[entry.book.id,entry.book.title,a.records.indexOf?.(entry.book)]));
  a.host.remove();b.host.remove();
 }
 expect(adopted).toBeGreaterThan(20);expect(adopted).toBeLessThan(300);
});

it('switches a lamp, finds pending covers and decides a shared inspection capture as before',()=>{
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
 const values=[undefined,null,0,.4,1,-0,NaN];
 for(let seed=0;seed<200;seed++){
  const next=random(seed+1100),pick=list=>list[Math.floor(next()*list.length)];
  const make=()=>({isOn:pick([undefined,false,true,0]),lampPower:next()<.5?{value:pick(values)}:undefined,
   model:next()<.6?{userData:{lightEmitter:next()<.6?{power:pick(values)}:undefined}}:undefined});
  const state=JSON.stringify(make()),[a,b]=[JSON.parse(state),JSON.parse(state)];
  const isOn=pick([true,false,undefined,0,null]),animate=next()<.5;clock=seed*16.5;
  reference.lampSwitch(a,isOn,animate);rust.scene_lamp_switch(b,isOn,animate);
  expect(b.isOn).toBe(a.isOn);expect(Object.entries(b.lampPower).map(([k,v])=>[k,bits([v])[0]])).toEqual(Object.entries(a.lampPower).map(([k,v])=>[k,bits([v])[0]]));
 }
 for(let seed=0;seed<200;seed++){
  const next=random(seed+1300),entries=Array.from({length:seed%6},()=>({kind:[undefined,'plant','lamp','book'][Math.floor(next()*4)],
   model:next()<.8?{visible:next()<.7?true:[false,0,undefined][Math.floor(next()*3)],userData:{coverLoaded:[undefined,true,false,null][Math.floor(next()*4)]}}:null}));
  for(const caller of [null,entries[0],entries[1]])expect(rust.scene_covers_pending(entries,caller)).toBe(reference.coversPending(entries,caller));
 }
 const canvas=(width,height)=>({width,height}),frameOf=(width,height,ratio)=>({width,height,ratio});
 let shared=0;
 for(let seed=0;seed<400;seed++){
  const next=random(seed+1500),pick=list=>list[Math.floor(next()*list.length)];
  const frame=frameOf(pick([100,100.5,33.3]),pick([80,79.2]),pick([1,1.5,2,2.625]));
  const width=Math.ceil(frame.width*frame.ratio),height=Math.ceil(frame.height*frame.ratio);
  const source={canvas:next()<.9?canvas(width,height):canvas(width+1,height)},raw={canvas:next()<.9?canvas(width,height):canvas(width,height-1)};
  const overview=next()<.5,revision=pick([1,2]);
  const captured=next()<.1?null:{overview:next()<.9?!overview:overview,frame:next()<.95?frame:{...frame},context:next()<.95?source:raw,revision:next()<.9?revision:3,
   width:next()<.95?width:width-1,height:next()<.95?height:-0};
  const args=[captured,overview,frame,next()<.95?raw:source,next()<.95?frame:null,source,revision,next()<.9?revision:0];
  const expected=reference.sharedCapture(...args);shared+=expected;
  expect(rust.scene_shared_capture(...args)).toBe(expected);
 }
 expect(shared).toBeGreaterThan(20);expect(shared).toBeLessThan(400);
});

it('makes a layout\'s fresh entries and previews with the same fields in the same order',()=>{
 const flags=Object.freeze({away:false});
 expect(JSON.stringify(rust.scene_fresh_preview())).toBe(JSON.stringify(reference.freshPreview()));
 for(let index=0;index<12;index++){
  const node=document.createElement('button');if(index%2)node.dataset.objectId=`o${index}`;
  const source={kind:['plant','lamp',undefined][index%3],node,book:index%4?{id:`b${index}`}:undefined,width:10+index,x:index,key:index%5?`k${index}`:undefined,
   ...(index%3?{lift:'old',written:'old',preview:'old'}:{})};
  const pose=new THREE.Object3D(),[a,b]=[reference.freshEntry(source,index,pose,flags),rust.scene_fresh_entry(source,index,pose,flags)];
  expect(Object.keys(b)).toEqual(Object.keys(a));
  for(const key of Object.keys(a))if(typeof a[key]!=='object'||a[key]===null)expect(Object.is(b[key],a[key])).toBe(true);
  expect(b.pose).toBe(pose);expect(b.flags).toBe(flags);expect(b.node).toBe(node);expect(b.book).toBe(source.book);
  for(const key of ['lift','offset','preview'])expect(JSON.stringify(b[key])).toBe(JSON.stringify(a[key]));
  expect(b.lift).not.toBe(source.lift);
 }
});

function layoutCase(seed,log){
 const next=random(seed+2000),pick=list=>list[Math.floor(next()*list.length)];
 const nodes=Array.from({length:12},(_,i)=>{
  const node=document.createElement('button');node.className=pick(['ihr-spine','ihr-spine is-away','']);
  if(next()<.5)node.setAttribute('style',`left: ${i}px;`);if(next()<.6)node.dataset.objectId=`o${i%7}`;
  node.dataset.plantModelDepth='1';node.dataset.n=String(i);return node;
 });
 const record=i=>({kind:pick(['plant','lamp',undefined,'plant']),node:pick([...nodes,null]),book:{id:`b${i%6}`},width:pick([10,12]),height:20,
  variant:pick([0,1]),catalogId:'c',potId:'p',potColorId:pick(['red','blue']),seed:1,lampId:pick(['l','m']),depth:5,mount:pick(['floor','undershelf']),style:{},coverUrl:''});
 const old=new Map(),foliage=new Map(),styles=new Map();
 for(let i=0;i<9;i++){
  const data=record(i),entry={...data,model:next()<.8?{userData:{shelfPlantKeys:'old',...(next()<.6?{updatePotColor(color){log.push(['recolor',color]);return next()<.7;}}:{})}}:null,
   plantQuality:next()<.4?{plan:{dispose(){log.push(['dispose',i]);}}}:null,preview:{x:5},landing:{},written:{},leanNode:data.node,domDirty:false,n:i};
  entry.key=reference.entryKey(data,i);old.set(entry.key,entry);
  if(data.node&&next()<.5){
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.innerHTML=`<path d="M${i} 0Z"></path>`;data.node.append(svg);
   foliage.set(data.node,{svg,path:svg.firstChild,exclusions:null,state:{n:i}});
  }
 }
 for(const node of nodes)if(next()<.2)styles.set(node,'kept');
 const entries=Array.from({length:4+seed%7},(_,i)=>record(next()<.7?i:i+20));
 const flags=Object.freeze({away:false});
 const host={foliage,styles,release:entry=>log.push(['release',entry.n]),place:entry=>log.push(['place',entry.n??entry.key,entry.node?.dataset.n]),
  fresh:(data,index)=>{log.push(['fresh',index]);return reference.freshEntry(data,index,{pose:index},flags);},
  record:(entry,data)=>log.push(['record',entry.n,data.book?.id,data.node?.dataset.n])};
 return {entries,old,host,nodes};
}
const layoutState=({old,host,nodes},retained)=>({
 retained:retained.map(entry=>[entry.n??null,entry.key,entry.kind,entry.node?.dataset.n,JSON.stringify(entry.preview),entry.landing,entry.written,entry.leanNode,entry.domDirty,
  Boolean(entry.plantQuality),entry.model?.userData.shelfPlantKeys,entry.potColorId,entry.width,entry.lampId]),
 old:[...old.keys()],
 foliage:[...host.foliage.entries()].map(([node,native])=>[node.dataset.n,native.svg.outerHTML,native.svg.parentNode?.dataset?.n,Object.keys(native),native.state.n]),
 styles:[...host.styles.entries()].map(([node,style])=>[node.dataset.n,style]),
 nodes:nodes.map(node=>node.outerHTML)
});
it('rebinds a committed layout\'s entries exactly as before',()=>{
 const seen=new Set();
 for(let seed=0;seed<160;seed++){
  const logs=[[],[]],[a,b]=[layoutCase(seed,logs[0]),layoutCase(seed,logs[1])];
  const expected=reference.rebindEntries(a.entries,a.old,a.host),native=rust.scene_rebind_entries(b.entries,b.old,b.host);
  expect(Array.isArray(native)).toBe(true);
  expect(layoutState(b,native)).toEqual(layoutState(a,expected));
  expect(logs[1]).toEqual(logs[0]);
  for(const [name] of logs[0])seen.add(name);
  a.nodes.forEach(node=>node.remove());b.nodes.forEach(node=>node.remove());
 }
 expect([...seen].sort()).toEqual(['dispose','fresh','place','recolor','record','release']);
});

function recordCase(seed,log){
 const next=random(seed+3000),pick=list=>list[Math.floor(next()*list.length)];
 const book=()=>({id:`b${seed}`,title:pick(['A','B']),author:'C',driveFileId:pick([undefined,'d1','d2']),pageEdgeFinish:pick([undefined,'gilt']),
  coverFinish:pick(['matte','gloss']),progressFraction:pick([0,.5])});
 const style=()=>({color:pick(['#335577','#775533']),coverRatio:pick([undefined,1.5,0,NaN]),heightRatio:pick([undefined,1,1.08,0]),width:pick([undefined,20,24]),fontFamily:'serif'});
 const node=document.createElement('button');if(next()<.3)node.className='is-away';
 const userData={};
 for(const name of ['updateSpineAppearance','updateCoverSource','updateCoverAppearance','updateEdgeAppearance','updateBookmark'])
  if(next()<.7)userData[name]=function(...args){log.push([name,this===userData,...args.map(a=>a?.id??a)]);};
 const entry={kind:pick(['book',undefined]),node,book:book(),style:style(),coverUrl:pick(['','blob:x']),x:pick([10,10.5]),y:pick([100,-0]),width:pick([20,24,'20']),
  height:pick([150,160]),thickness:pick([24,undefined]),depthInset:0,shelf:pick([0,1,2,'1',undefined]),insertion:next()<.1?{}:null,trashDrop:null,
  model:next()<.75?{userData}:null,replacement:next()<.2?{}:null};
 if(entry.model&&next()<.6)entry.model.userData.shelfKeys={spine:"old",bookmark:pick(["old",undefined])};
 const rows=[{top:20,bottom:220},{top:240,bottom:pick([300,460])},undefined];
 const dimensions=next()<.4?{width:pick([undefined,22]),height:pick([undefined,170]),thickness:undefined,x:pick([undefined,5]),y:undefined,depthInset:pick([undefined,2]),shelf:pick([undefined,1])}:null;
 const host={bookmarkFor,rows,usableDepth:pick([210,250]),baggeboScale:pick([1,.65]),recordDimensions:io=>rust.scene_record_dimensions(io),
  place:entry=>log.push(['place',entry.width,entry.height,entry.shelf]),replace:entry=>log.push(['replace',entry.book.id]),identity:()=>log.push(['identity'])};
 return {entry,args:[book(),style(),pick(['','blob:y','blob:x']),dimensions],host};
}
it('takes a book\'s newer record exactly as before',()=>{
 let changed=0;
 for(let seed=0;seed<400;seed++){
  const logs=[[],[]],[a,b]=[recordCase(seed,logs[0]),recordCase(seed,logs[1])];
  const expected=reference.updateRecord(a.entry,...a.args,a.host),native=rust.scene_update_record(b.entry,...b.args,b.host);
  expect(native).toBe(expected);changed+=expected;
  expect(logs[1]).toEqual(logs[0]);
  const fields=entry=>['x','y','width','height','thickness','depthInset','shelf'].map(key=>bits([entry[key]])[0]).concat([entry.book.id,entry.coverUrl,JSON.stringify(entry.model?.userData.shelfKeys)]);
  expect(fields(b.entry)).toEqual(fields(a.entry));expect(b.entry.style).toBe(b.args[1]);expect(b.entry.book).toBe(b.args[0]);
 }
 expect(changed).toBeGreaterThan(40);expect(changed).toBeLessThan(400);
 for(let seed=0;seed<40;seed++){
  const [a,b]=[recordCase(seed,[]),recordCase(seed,[])];
  expect(rust.scene_hidden_material(b.entry)).toBe(reference.hiddenBookMaterial(a.entry));
 }
});

function releaseCase(seed,log){
 const next=random(seed+4000),parent={children:[]},model=name=>{
  const user=next()<.8?{dispose(){log.push(['dispose',name]);}}:{};
  const object={name,userData:user,removeFromParent(){log.push(['remove',name]);}};return object;
 };
 const node=next()<.85?document.createElement('button'):null;
 if(node){node.dataset.plantModelCatalogId='c';node.dataset.plantLeafOpacity='opaque';node.dataset.other='1';}
 const shown=next()<.7?model('shown'):null,released=new WeakSet(),foliage=new Map();
 const entry={node,model:shown,replacement:next()<.5?(next()<.3&&shown?shown:model('replacement')):null,qualityReplacement:true,replacementReady:true,
  plantQuality:next()<.3?{plan:{dispose(){log.push(['plan']);}}}:undefined,lampHull:next()<.3?{free(){log.push(['hull']);}}:undefined};
 if(next()<.2&&entry.replacement)released.add(entry.replacement);
 if(node&&next()<.5){const svg=document.createElement('span');node.append(svg);foliage.set(node,{svg,state:{free(){log.push(['state']);}}});}
 return {entry,foliage,released,parent};
}
it('releases candidates, replacements and leaving entries as before',()=>{
 const seen=new Set();
 for(let seed=0;seed<200;seed++){
  const logs=[[],[]],[a,b]=[releaseCase(seed,logs[0]),releaseCase(seed,logs[1])];
  const expected=reference.releaseEntry(a.entry,a.foliage,a.released);
  expect(rust.scene_release_entry(b.entry,b.foliage,b.released)).toBe(expected);
  expect(logs[1]).toEqual(logs[0]);for(const [name] of logs[0])seen.add(name);
  const state=({entry,foliage})=>[entry.node?.outerHTML,entry.model,entry.replacement,entry.plantQuality,entry.lampHull,entry.qualityReplacement,entry.replacementReady,foliage.size];
  expect(state(b)).toEqual(state(a));
  // A second release of the same candidate does nothing, a fresh one is disposed once.
  const candidate={userData:{dispose(){logs[0].push('again');}}};
  reference.releaseCandidate(candidate,a.released);rust.scene_release_candidate(candidate,b.released);
  expect(logs[0].filter(item=>item==='again')).toHaveLength(2);
  rust.scene_release_candidate(candidate,b.released);rust.scene_release_candidate(null,b.released);
  expect(logs[0].filter(item=>item==='again')).toHaveLength(2);
 }
 expect([...seen].sort()).toEqual(['dispose','hull','plan','remove','state']);
});
