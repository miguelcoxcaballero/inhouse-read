import {expect,it,vi,afterEach} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import * as reference from './helpers/reference-scene-room.js';

// The shelf scene's room set-up recipes that moved to rust-ui/src/scene_room.rs, each run against its
// frozen JavaScript original (helpers/reference-scene-room.js) on equal inputs: the same objects with
// the same parameters, names, flags, children and relative three.js ids (render-list ties fall back
// to them), the same DOM, the same calls in the same order and the same returned values.
afterEach(()=>vi.restoreAllMocks());
const random=seed=>()=>((seed=Math.imul(seed^seed>>>15,2246822519)+1013904223|0)>>>0)/4294967296;
const bits=values=>Array.from(values,value=>Object.is(value,-0)?'-0':String(value));
const relative=ids=>ids.map(id=>id-ids[0]);
const describeMaterial=material=>{const json=material.toJSON();delete json.uuid;delete json.metadata;
 for(const key of ['map','bumpMap','roughnessMap'])if(json[key])json[key]=material[key]===undefined?null:material[key].name;
 delete json.textures;delete json.images;return {type:material.type,json,userData:{...material.userData},id:material.id};};
const describeObject=object=>({type:object.type,name:object.name,visible:object.visible,receiveShadow:object.receiveShadow,castShadow:object.castShadow,
 userData:JSON.stringify(object.userData),position:bits(object.position.toArray()),scale:bits(object.scale.toArray()),
 geometry:object.geometry&&{type:object.geometry.type,parameters:JSON.stringify(object.geometry.parameters),id:object.geometry.id},
 material:object.material&&object.material.id,raycast:object.raycast===THREE.Mesh.prototype.raycast?'mesh':typeof object.raycast,id:object.id,
 children:object.children.map(child=>child.id)});
function textures(){const texture=new THREE.Texture(),grain=new THREE.Texture();texture.name='veneer';grain.name='grain';return {texture,grain};}
function relativeIds(list,key){return relative(list.map(item=>item[key]))}

it('creates the room\'s materials and fixed meshes as the scene did, in the same order',()=>{
 const run=create=>{
  const {texture,grain}=textures(),furniture=new THREE.Group(),penumbra=[];
  const wide=material=>{penumbra.push(material.type);material.userData.widePenumbra=true;return material;};
  const made=create(texture,grain,wide,furniture);
  const [wood,back,dark,occlusionMaterial,depthOnly,occlusion,floor,wallMaterial,wall]=made;
  const materials=[wood,back,dark,occlusionMaterial,...depthOnly,wallMaterial];
  return {penumbra,materials:materials.map(describeMaterial),materialIds:relativeIds(materials,'id'),
   floorMaterial:floor.material.id-wood.id,objects:[occlusion,floor,wall].map(describeObject),objectIds:relativeIds([occlusion,floor,wall],'id'),
   geometries:relative([occlusion,floor,wall].map(object=>object.geometry.id)),children:furniture.children.map(child=>child.name),
   floorMap:floor.material.map===texture,mapsShared:wood.map===texture&&wood.bumpMap===grain&&back.roughnessMap===grain};
 };
 const strip=value=>JSON.parse(JSON.stringify(value,(key,item)=>key==='id'||key==='material'||key==='children'&&Array.isArray(item)&&typeof item[0]==='number'?undefined:item));
 const expected=run(reference.roomMaterials);
 const native=run((texture,grain,wide,furniture)=>rust.scene_room_materials(THREE,texture,grain,wide,furniture,()=>{}));
 expect(strip(native)).toEqual(strip(expected));
 expect(native.materialIds).toEqual(expected.materialIds);expect(native.objectIds).toEqual(expected.objectIds);
 expect(native.geometries).toEqual(expected.geometries);expect(native.floorMaterial).toBe(expected.floorMaterial);
 expect(native.objects.map(object=>object.raycast)).toEqual(['function','mesh','function']);
});

it('prepares the hidden placement guide and the return\'s depth writers',()=>{
 const run=create=>{
  const furniture=new THREE.Group(),depthOnly=[THREE.FrontSide,THREE.BackSide,THREE.DoubleSide].map(side=>new THREE.MeshBasicMaterial({side,colorWrite:false}));
  const [marker,guide,writers]=create(furniture,depthOnly);
  const objects=[marker,...marker.children,...writers];
  return {objects:objects.map(describeObject).map(({id,children,material,geometry,...rest})=>({...rest,geometry:geometry&&{...geometry,id:undefined}})),
   ids:relativeIds(objects,'id'),material:describeMaterial(guide.material),sharedMaterial:marker.children[1].material===guide.material,
   writerGeometry:writers.every(writer=>writer.geometry===guide.geometry),writerMaterials:writers.map((writer,index)=>writer.material===depthOnly[index]),
   inFurniture:furniture.children.includes(marker),geometryIds:relative(objects.filter(object=>object.geometry).map(object=>object.geometry.id))};
 };
 const expected=run(reference.dropMarker),native=run((furniture,depthOnly)=>rust.scene_room_drop_marker(THREE,furniture,depthOnly));
 delete expected.material.id;delete native.material.id;
 expect(native).toEqual(expected);
});

it('builds the native room\'s clip at the end of its stage',()=>{
 const stage=()=>{const node=document.createElement('div');node.innerHTML='<canvas></canvas><span></span>';return node;};
 const a=stage(),b=stage();
 const expected=reference.nativeRoomClip(a),native=rust.scene_native_room_clip(b);
 expect(b.outerHTML).toBe(a.outerHTML);expect(native).toBe(b.lastChild);expect(native.outerHTML).toBe(expected.outerHTML);
});

// Every call to a 2D context, with canvases named by their role and size.
function recorder(log,name){
 const record=method=>(...args)=>log.push([name,method,...args.map(arg=>arg&&typeof arg==='object'?arg.role??`canvas:${arg.width}x${arg.height}`:bits([arg])[0])]);
 return {clearRect:record('clearRect'),drawImage:record('drawImage')};
}
it('exports the native room and a returning book as the scene did',()=>{
 const frames=[];
 for(const physical of [true,false,undefined,1,''])for(const margin of [0,4,-0,NaN,2.5])for(const ratio of [1,1.5,2,2.625,undefined,'2'])
  frames.push({frame:{physical,width:321.3,height:200.7,ratio,x:-3.5,y:12.25},margin});
 for(const tileContext of [true,false])for(const {frame,margin} of frames){
  const run=exporter=>{
   const log=[],sizes=[];
   vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(kind){log.push(['tile','getContext',kind,this.width,this.height]);return tileContext?recorder(log,'tile'):null;});
   const raw=recorder(log,'raw'),canvas={width:640,height:401,role:'room'},source={role:'gl'};
   const created=document.createElement.bind(document);
   vi.spyOn(document,'createElement').mockImplementation(tag=>{const node=created(tag);sizes.push(node);return node;});
   let error=null;
   try{exporter(raw,canvas,source,frame,margin);}catch(caught){error=caught.message;}
   vi.restoreAllMocks();
   return {log,error,tiles:sizes.map(node=>[node.width,node.height])};
  };
  const expected=run(reference.nativeRoomExport),native=run((...args)=>rust.scene_native_room_export(...args));
  expect(native).toEqual(expected);
 }
 for(const {frame} of frames){
  const run=exporter=>{const log=[];exporter(recorder(log,'raw'),{width:390,height:844},{role:'gl'},frame);return log;};
  expect(run((...args)=>rust.scene_insertion_export(...args))).toEqual(run(reference.insertionExport));
 }
});

it('rebuilds each unit\'s baked occlusion as the scene did',()=>{
 for(let seed=0;seed<40;seed++){
  const next=random(seed),units=[0,1,2,3,1.5,2.5][seed%6],baggebo=seed%7===3,floorLit=next()<.5;
  const rows=Array.from({length:6},(_,index)=>({top:index*100,bottom:index*100+90,...(next()<.8?{unit:[0,1,2,'1',null,undefined,-0,NaN][Math.floor(next()*8)]}:{})}));
  const plan=Float64Array.from({length:10+Math.max(1,Math.ceil(units))},()=>next()*400-200);
  const trashPose=next()<.6?{x:next()*90,z:-next()*30,radius:next()*20+5}:null;
  const light=[.5,.4,.29,.11];
  const run=build=>{
   const log=[],occlusion=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());
   const trash=trashPose&&Object.assign(new THREE.Group(),{userData:{radius:trashPose.radius}});
   trash?.position.set(trashPose.x,0,trashPose.z);
   const createShelfOcclusion=options=>{
    log.push(['create',JSON.stringify({...options,rows:options.rows.map(row=>rows.indexOf(row)),floorLight:options.floorLight===light?'light':options.floorLight})]);
    const geometry=new THREE.BufferGeometry();geometry.name=`part${log.length}`;
    geometry.translate=(...args)=>{log.push(['translate',geometry.name,...bits(args)]);return geometry;};
    geometry.dispose=()=>log.push(['dispose',geometry.name]);return geometry;
   };
   const mergeGeometries=(parts,attributes)=>{log.push(['merge',parts.map(part=>part.name),attributes]);const merged=new THREE.BufferGeometry();merged.name='merged';return merged;};
   build({occlusion,shelfType:baggebo?'baggebo':'walnut',plan,unitCount:units,unitWidth:600,height:1160,depth:250,floorY:-1160.5,rows,floorLit,trash,
    darkFloorLight:light,createShelfOcclusion,mergeGeometries});
   return {log,visible:occlusion.visible,geometry:occlusion.geometry.name||occlusion.geometry.type};
  };
  const expected=run(reference.roomOcclusion);
  const native=run(o=>rust.scene_room_occlusion(THREE,o.occlusion,o.shelfType==='baggebo',o.shelfType==='baggebo'?new Float64Array(0):o.plan,o.unitCount,o.unitWidth,
   o.height,o.depth,o.floorY,o.rows,o.floorLit?o.darkFloorLight:null,o.trash,o.createShelfOcclusion,o.mergeGeometries));
  expect(native).toEqual(expected);
 }
});

it('places the floor and the room\'s wall from the room\'s plan',()=>{
 for(let seed=0;seed<12;seed++){
  const next=random(seed+50),room=Float64Array.from({length:10+seed%3},()=>next()*800-400);
  const run=place=>{
   const floor=new THREE.Mesh(new THREE.BoxGeometry(1,2,1)),wall=new THREE.Mesh(new THREE.PlaneGeometry(1,1)),old=floor.geometry;let disposed=0;
   old.dispose=()=>disposed++;
   place(floor,wall,room);
   return {disposed,parameters:JSON.stringify(floor.geometry.parameters),box:floor.geometry.boundingBox&&bits([...floor.geometry.boundingBox.min.toArray(),...floor.geometry.boundingBox.max.toArray()]),
    position:bits(floor.position.toArray()),wall:bits([...wall.scale.toArray(),...wall.position.toArray()]),fresh:floor.geometry!==old};
  };
  expect(run((floor,wall,plan)=>rust.scene_room_floor(THREE,floor,wall,plan))).toEqual(run(reference.roomFloor));
 }
});

function stages(seed){
 const next=random(seed+90),root=document.createElement('main');
 root.innerHTML=`<section class="${next()<.5?'has-scene':''}" style="height:${seed}px;top:3px"><button style="left:1px" data-scene-projected="true"><span data-shelf-cover-hit="true"></span></button><button></button></section>`+
  `<section class="${next()<.5?'has-scene x':'x'}" style="${next()<.5?'height:7px;top:-2px':''}"><i></i></section>`;
 const [stage,nextStage]=root.children,buttons=[...stage.querySelectorAll('button')];
 const styles=new Map(buttons.map((button,index)=>[button,index?null:'left:9px']));
 const covers=new Map([[buttons[0],buttons[0].firstChild]]);
 const canvases=[document.createElement('canvas'),document.createElement('canvas'),document.createElement('canvas'),next()<.6?document.createElement('div'):null];
 canvases.forEach((node,index)=>node&&(node.id=`c${index}`));
 stage.prepend(canvases[0]);
 return {root,stage,nextStage,styles,covers,canvases,already:next()<.5};
}
it('moves the scene to a new stage and leaves it when disposed, as the scene did',()=>{
 for(let seed=0;seed<16;seed++){
  const a=stages(seed),b=stages(seed);
  const expected=reference.moveStage(a.stage,a.nextStage,'12px','-4px',a.already,a.styles,a.covers,rust.scene_restore_buttons,a.canvases);
  const native=rust.scene_move_stage(b.stage,b.nextStage,'12px','-4px',b.already,b.styles,b.covers,b.canvases);
  expect([...native]).toEqual(expected);expect(b.root.innerHTML).toBe(a.root.innerHTML);expect(b.styles.size).toBe(a.styles.size);expect(b.covers.size).toBe(a.covers.size);
  const c=stages(seed),d=stages(seed);
  for(const [x,y] of [[c,d]]){x.canvases[1].width=y.canvases[1].width=50;}
  reference.releaseStage(c.stage,'8px',c.already,c.styles,rust.scene_restore_buttons,c.canvases);
  rust.scene_release_stage(d.stage,'8px',d.already,d.styles,d.canvases);
  expect(d.root.innerHTML).toBe(c.root.innerHTML);
  expect(d.canvases.slice(1,3).map(node=>[node.width,node.height])).toEqual(c.canvases.slice(1,3).map(node=>[node.width,node.height]));
 }
});

it('starts a drop into the bin with the same record',()=>{
 for(let seed=0;seed<60;seed++){
  const next=random(seed+700),durations=[850,0,200,undefined,null,'300',NaN,-0,-50,'x',{valueOf:()=>120}];
  const duration=durations[seed%durations.length],openness=[undefined,null,'0.4',.7,NaN,-0,1][seed%7],reduced=next()<.3,now=next()*1e5;
  const model=new THREE.Object3D();model.position.set(next()*9,-0,next());model.quaternion.setFromEuler(new THREE.Euler(next(),next(),0));model.scale.setScalar(next()+.5);
  const trash={userData:{openness}},resolve=()=>{};
  const describe=record=>Object.entries(record).map(([key,value])=>[key,value?.isVector3||value?.isQuaternion?bits(value.toArray()):typeof value==='function'?value===resolve:bits([value])[0]]);
  const expected=reference.trashDropRecord(resolve,now,reduced,duration,model,trash),native=rust.scene_trash_drop_record(THREE,resolve,now,reduced,duration,model,trash);
  expect(describe(native)).toEqual(describe(expected));
  expect(native.start).not.toBe(model.position);expect(native.startQuaternion).not.toBe(model.quaternion);
  expect(native.start.isVector3&&native.endQuaternion.isQuaternion&&native.bookQuaternion.isQuaternion).toBe(true);
 }
});
