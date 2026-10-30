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

it('stands the bin on the floor clear of the wall',()=>{
 for(let seed=0;seed<30;seed++){
  const next=random(seed+900),radius=[18,'12',undefined,0,-0,7.25][seed%6],floorY=-next()*1200,gap=12;
  const minY=-next()*3,minZ=-next()*40,wallZ=-next()*300;
  const run=place=>{
   const scene=new rust.RustScene(390+seed,1160,390,250,seed%2===1,true,0);
   const trash=new THREE.Group();trash.userData.radius=radius;trash.position.set(3,4,5);trash.rotation.set(.1,.2,.3);trash.scale.setScalar(2);trash.visible=false;
   const bounds=new THREE.Box3(new THREE.Vector3(-20,minY,minZ),new THREE.Vector3(20,40,10)),wall=new THREE.Object3D();wall.position.z=wallZ;
   place(scene,trash,bounds,wall,floorY,gap);scene.free();
   return bits([...trash.position.toArray(),...trash.rotation.toArray().slice(0,3),...trash.scale.toArray(),trash.visible]);
  };
  expect(run((...args)=>rust.scene_position_trash(...args))).toEqual(run(reference.positionTrash));
 }
});

it('samples the walnut maps as the scene did',()=>{
 for(const colour of [true,false,1,0,'',null])for(const most of [1,4,8,16,NaN]){
  const run=configure=>{const map=new THREE.Texture(),renderer={capabilities:{getMaxAnisotropy:()=>most}};const back=configure(map,renderer,colour);
   return {same:back===map,colorSpace:map.colorSpace,wrap:[map.wrapS,map.wrapT],repeat:bits(map.repeat.toArray()),anisotropy:bits([map.anisotropy])};};
  expect(run((map,renderer,c)=>rust.scene_walnut_map(THREE,map,Boolean(c),renderer))).toEqual(run(reference.walnutMap));
 }
});

it('moves a book\'s projected rectangle into the page for its pose',()=>{
 const rects=[null,undefined,{left:4,right:30,top:-2,bottom:90,width:26,height:92,closest:.5},{left:-0,right:NaN,top:1.5,bottom:2}];
 const poses=[null,{matrix:[1,2],rect:'old',x:1},{scale:2}];
 for(const rect of rects)for(const pose of poses)for(const stage of [{left:10.5,top:-3},{left:-0,top:0}]){
  const expected=reference.bookPose(pose,{rect},stage),native=rust.scene_book_pose(pose,rect,stage);
  expect(Object.keys(native)).toEqual(Object.keys(expected));
  expect(JSON.stringify(native,(key,value)=>Object.is(value,-0)?'-0':Number.isNaN(value)?'NaN':value)).toBe(JSON.stringify(expected,(key,value)=>Object.is(value,-0)?'-0':Number.isNaN(value)?'NaN':value));
  if(rect)expect(native.rect).not.toBe(rect);
 }
});

it('holds a grabbed book where the ray or the finger met it',()=>{
 for(let seed=0;seed<24;seed++){
  const next=random(seed+1200),hit=seed%3?new THREE.Vector3(next()*20,next()*200-100,next()*5):undefined;
  const run=grip=>{
   const model=new THREE.Object3D();model.position.set(5,-40,2);model.rotation.set(0,.4,.1);model.updateMatrixWorld(true);
   const entry={model,height:[180,0,'90'][seed%3]},node={getBoundingClientRect:()=>({top:100,height:[0,240,undefined,60][seed%4]})};
   grip(entry,node,[150,undefined,90.5][seed%3],hit);return bits([entry.gripHeight]);
  };
  expect(run((...args)=>rust.scene_object_grip(...args))).toEqual(run(reference.objectGrip));
 }
});

it('eases a lamp to its new colour temperature',()=>{
 for(const existing of [false,true])for(const animate of [true,false,0,undefined])for(const reduced of [false,true]){
  const run=change=>{
   const log=[],make=kelvin=>({made:kelvin,set:(...args)=>log.push(['set',args[0],typeof args[1],args[2]])});
   const entry={kelvin:2700,lampTint:existing?make('old'):undefined};
   vi.spyOn(performance,'now').mockReturnValue(1234.5);
   change(entry,4000,animate,{matches:reduced},make);vi.restoreAllMocks();
   return {log,kelvin:entry.kelvin,made:entry.lampTint.made};
  };
  expect(run((entry,kelvin,animate,reduced,make)=>rust.scene_lamp_kelvin(entry,kelvin,animate&&!reduced.matches,make))).toEqual(run(reference.lampKelvin));
 }
});

it('lets go of the room in the order the scene did',()=>{
 for(let seed=0;seed<8;seed++){
  const run=release=>{
   const log=[],named=(name,extra={})=>({dispose:()=>log.push(`${name}.dispose`),...extra});
   const furniture=new THREE.Group();
   for(let index=0;index<4;index++){const child=new THREE.Group();child.name=`c${index}`;if(index%2===seed%2)child.userData={furniture:true,...(index>1?{disposeGeometry:()=>log.push(`c${index}.geometry`)}:{})};furniture.add(child);}
   const catalog=seed%3?Object.assign(new THREE.Group(),{name:'catalog'}):null;if(catalog){catalog.userData.dispose=()=>log.push('catalog.dispose');furniture.add(catalog);}
   const trash=seed%4?Object.assign(new THREE.Group(),{name:'trash'}):(seed%2?null:undefined);if(trash){trash.userData.dispose=()=>log.push('trash.dispose');furniture.add(trash);}
   const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());mesh.geometry.addEventListener('dispose',()=>log.push('mesh.geometry'));furniture.add(mesh);
   release({furniture,catalog,trash,lampLighting:named('lamps'),lighting:named('lighting'),texture:named('texture'),grain:named('grain'),wood:named('wood'),
    backWood:named('back'),darkWood:named('dark'),depthOnly:[named('d0'),named('d1'),named('d2')],releaseObject:object=>rust.scene_release_object(object)});
   return {log,children:furniture.children.map(child=>child.name||child.type)};
  };
  expect(run(o=>rust.scene_dispose_room(o.furniture,o.catalog,o.trash,o.lampLighting,o.lighting,[o.texture,o.grain],[o.wood,o.backWood,o.darkWood,...o.depthOnly])))
   .toEqual(run(reference.disposeRoom));
 }
});

it('starts a returning book\'s insertion with the same record and clock reads',()=>{
 const durations=[180,0,90,undefined,null,'45',NaN,-0,-5,'x'];
 for(const duration of durations)for(const reduced of [false,true])for(const overlay of [null,{width:780}]){
  const run=make=>{
   let tick=100;vi.spyOn(performance,'now').mockImplementation(()=>tick+=16.5);
   const slot={kind:'slot'},resolve=()=>{},presentation=overlay&&{native:true};
   const record=make(slot,reduced,duration,resolve,overlay,presentation);vi.restoreAllMocks();
   const name=value=>value===slot?'slot':value===resolve?'resolve':value===overlay?'overlay':value===presentation?'presentation':value;
   return Object.entries(record).map(([key,value])=>[key,typeof value==='number'?bits([value])[0]:name(value)]);
  };
  expect(run((...args)=>rust.scene_insertion_record(...args))).toEqual(run(reference.insertionRecord));
 }
});
