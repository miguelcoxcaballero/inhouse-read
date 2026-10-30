// The shelf scene's one-off room recipes (rust-ui/src/scene_room.rs) against their frozen JavaScript
// originals (tests/unit/helpers/reference-scene-room.js): median microseconds per call. Each runs once
// per scene, rebuild, theme change, drop or export, never per frame or per entry; Node/WASM, no DOM.
// node scripts/benchmark-scene-room.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const reference=await import('../tests/unit/helpers/reference-scene-room.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
function time(label,js,native,rounds=400){
 for(let i=0;i<50;i++){js();native();}
 const a=[],b=[];
 for(let i=0;i<rounds;i++){let t=performance.now();js();a.push(performance.now()-t);t=performance.now();native();b.push(performance.now()-t);}
 console.log(`${label.padEnd(26)} JS ${(median(a)*1000).toFixed(1).padStart(7)} µs   Rust ${(median(b)*1000).toFixed(1).padStart(7)} µs`);
}
const texture=new THREE.Texture(),grain=new THREE.Texture(),wide=material=>material;
time('room materials',()=>reference.roomMaterials(texture,grain,wide,new THREE.Group()),
 ()=>rust.scene_room_materials(THREE,texture,grain,wide,new THREE.Group(),()=>{}));
const depthOnly=[0,1,2].map(side=>new THREE.MeshBasicMaterial({side,colorWrite:false}));
time('placement guide',()=>reference.dropMarker(new THREE.Group(),depthOnly),()=>rust.scene_room_drop_marker(THREE,new THREE.Group(),depthOnly));
const rows=Array.from({length:12},(_,index)=>({top:index*100,bottom:index*100+90,unit:index%3}));
const plan=Float64Array.from({length:13},(_,index)=>index*40),trash=new THREE.Group();trash.userData.radius=18;
const create=()=>new THREE.BufferGeometry(),merge=parts=>parts[0];
const occlusion=new THREE.Mesh(new THREE.BufferGeometry());
time('occlusion, 3 units',()=>reference.roomOcclusion({occlusion,shelfType:'walnut',plan,unitCount:3,unitWidth:600,height:1160,depth:250,floorY:-1160,rows,
 floorLit:true,trash,darkFloorLight:[.5,.4,.29,.11],createShelfOcclusion:create,mergeGeometries:merge}),
 ()=>rust.scene_room_occlusion(THREE,occlusion,false,plan,3,600,1160,250,-1160,rows,[.5,.4,.29,.11],trash,create,merge));
const model=new THREE.Object3D(),bin={userData:{openness:.3}},resolveDrop=()=>{};
time('bin drop record',()=>reference.trashDropRecord(resolveDrop,1000,false,850,model,bin),()=>rust.scene_trash_drop_record(THREE,resolveDrop,1000,false,850,model,bin));
const floor=new THREE.Mesh(new THREE.BoxGeometry(1,2,1)),wall=new THREE.Mesh(new THREE.PlaneGeometry(1,1)),room=Float64Array.from({length:11},(_,i)=>i*3+1);
time('floor and wall',()=>reference.roomFloor(floor,wall,room),()=>rust.scene_room_floor(THREE,floor,wall,room));
