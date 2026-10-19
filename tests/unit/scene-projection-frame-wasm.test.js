// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust,shelfWasm} from './helpers/rust-shelf-ready.js';
import {createSceneProjectionFrame} from '../../src/js/scene-projection-frame.js';

const initial=()=>({left:NaN,top:NaN,width:NaN,height:NaN,z:NaN,fixed:false,coverLeft:NaN,coverTop:NaN,coverWidth:NaN,coverHeight:NaN,display:'',events:'',coverFixed:false});
// Frozen decision order from the former scene cache, including resets when a
// cover node appears later and JS NaN/signed-zero comparison semantics.
function previousWrites(cache,rect,v,kind,fresh){
 const writes=[],put=(name,value)=>writes.push([name,value]);
 if(!cache.fixed)put('position','absolute');
 for(const [name,index]of [['left',40],['top',41],['width',42],['height',43]])if(v[index]!==cache[name])put(name,`${cache[name]=v[index]}px`);
 if(!cache.fixed)put('margin','0');
 if(v[44]!==cache.z)put('zIndex',String(cache.z=v[44]));
 if(!cache.fixed){put('dataset','initial');cache.fixed=true;}
 if(kind!==1){
  if(fresh)Object.assign(cache,{coverFixed:false,coverLeft:NaN,coverTop:NaN,coverWidth:NaN,coverHeight:NaN,display:'',events:''});
  if(!cache.coverFixed)put('cover.position','absolute');
  for(const [name,value]of [['coverLeft',v[45]],['coverTop',v[46]],['coverWidth',rect.width],['coverHeight',rect.height]])if(value!==cache[name])put(name,`${cache[name]=value}px`);
  const display=v[47]?'block':'none';if(display!==cache.display)put('display',cache.display=display);
  if(!cache.coverFixed){put('cover.background','transparent');cache.coverFixed=true;}
  const events=v[48]?'inherit':'none';if(events!==cache.events)put('events',cache.events=events);
 }
 return writes;
}
function retainedWrites(bits,rect,v){
 const writes=[],put=(name,value)=>writes.push([name,value]);
 if(bits&1)put('position','absolute');
 for(const [bit,name,index]of [[2,'left',40],[4,'top',41],[8,'width',42],[16,'height',43]])if(bits&bit)put(name,`${v[index]}px`);
 if(bits&1)put('margin','0');if(bits&32)put('zIndex',String(v[44]));if(bits&1)put('dataset','initial');
 if(bits&64)put('cover.position','absolute');
 for(const [bit,name,value]of [[128,'coverLeft',v[45]],[256,'coverTop',v[46]],[512,'coverWidth',rect.width],[1024,'coverHeight',rect.height]])if(bits&bit)put(name,`${value}px`);
 if(bits&2048)put('display',v[47]?'block':'none');if(bits&64)put('cover.background','transparent');if(bits&4096)put('events',v[48]?'inherit':'none');
 return writes;
}
function project(scene,entry,kind,flags,drop,insertion,matrix,v){
 v[0]=kind;v[1]=flags;v[2]=drop?1:0;v[3]=insertion?1:0;v[4]=entry.model?1:0;v[5]=entry.overview?1:0;v[6]=drop?.complete?1:0;v[7]=insertion?.overlayCanvas?1:0;
 v.set(entry.box,8);v.set(matrix.elements,14);scene.projectEntry(v);
}
function hit(scene,kind,undershelf,flags,disabled,rect,box,matrix,v){
 v[0]=kind;v[1]=undershelf?1:0;v[2]=flags;v[3]=disabled?1:0;v[4]=rect.left;v[5]=rect.right;v[6]=rect.top;v[7]=rect.bottom;v[8]=rect.width;v[9]=rect.height;v[10]=rect.closest;
 v.set(box,11);v.set(matrix.elements,17);scene.hitEntry(v);
}
const rectangle=v=>({left:v[30],right:v[31],top:v[32],bottom:v[33],width:v[34],height:v[35],closest:v[36]});

it('preserves projection bytes and exact style writes across views, object states, node resets and reordering',()=>{
 const frame=createSceneProjectionFrame(rust),scene=new rust.RustScene(390,1200,390,180,false,false,0),oldProject=new Float64Array(44),oldHit=new Float64Array(49);
 let entries=Array.from({length:12},(_,i)=>({box:Float64Array.of(-15,-100,-8,15,100,8),model:i%2?{}:null,overview:false,kind:i%3})),cache=entries.map(initial);
 const model=new THREE.Object3D(),inverse=new Float64Array([0,0,0,1]);let stable=0;
 try{
  for(let tick=0;tick<1200;tick++){
   if(tick===400||tick===800){entries=entries.toReversed();cache=entries.map(initial);}
   if(tick%250===0)scene.setMode(tick%500===0,false,tick*16,0);
   scene.beginEntries(tick*16,false,tick%200<100?1:2,inverse,2,tick%140<70?390:800,tick%100<50?0:600,44);
   frame.prepare(entries);
   for(let i=0;i<entries.length;i++){
    const e=entries[i],kind=e.kind,flags=Math.floor(tick/15)%8,under=kind===2&&i%2===0,disabled=tick%70<10;
    const drop=tick%150<5?{complete:tick%150<2}:null,insert=tick%180<6?{overlayCanvas:tick%180<3?{}:null}:null;
    e.overview=tick%100<40;
    model.position.set(i*33,Math.floor(tick/3)%20*5-i*100,3);model.rotation.set(.1,.2,Math.floor(tick/3)*.002,'ZYX');model.updateMatrix();
    project(scene,e,kind,flags,drop,insert,model.matrix,oldProject);frame.project(scene,e,kind,flags,drop,insert,model.matrix);
    expect(frame.projection.slice(30)).toEqual(oldProject.slice(30));
    const rect=rectangle(oldProject),reset=tick%111===0,fresh=kind!==1&&tick%139===0;
    if(reset)cache[i]=initial();
    hit(scene,kind,under,flags,disabled,rect,e.box,model.matrix,oldHit);
    const dirty=frame.hit(scene,i,kind,under,flags,disabled,rect,e.box,model.matrix,reset,fresh);
    expect(frame.hitOutput.slice(33)).toEqual(oldHit.slice(33));
    expect(retainedWrites(dirty,rect,frame.hitOutput)).toEqual(previousWrites(cache[i],rect,oldHit,kind,fresh));
    if(dirty===0)stable++;
   }
  }
  expect(stable).toBeGreaterThan(5000);
 }finally{frame.free();scene.free();}
});
it('keeps NaN invalidation and signed-zero behavior while surviving memory growth and releasing arenas',()=>{
 const handles=rust.shelf_live_handles(),frame=createSceneProjectionFrame(rust),scene=new rust.RustScene(390,700,390,150,false,false,0),entry={box:Float64Array.of(-5,-50,-5,5,50,5),model:null,overview:false},matrix=new THREE.Matrix4(),cache=initial(),oldHit=new Float64Array(49);
 const entries=[entry];scene.beginEntries(0,false,1,[0,0,0,1],2,390,0,44);frame.prepare(entries);
 try{
  frame.project(scene,entry,0,0,null,null,matrix);const snapshot=frame.projection.slice();shelfWasm.memory.grow(1);
  for(const value of [0,-0,-0,NaN,NaN,Infinity,-Infinity,0]){
   const rect={left:value,right:100,top:20,bottom:200,width:value,height:180,closest:0};
   hit(scene,0,false,0,false,rect,entry.box,matrix,oldHit);
   const dirty=frame.hit(scene,0,0,false,0,false,rect,entry.box,matrix,false,false);
   expect(retainedWrites(dirty,rect,frame.hitOutput)).toEqual(previousWrites(cache,rect,oldHit,0,false));
   expect(frame.projection).toEqual(snapshot);
  }
  for(let i=0;i<250;i++){frame.prepare([...entries]);frame.project(scene,entry,0,0,null,null,matrix);frame.hit(scene,0,0,false,0,false,rectangle(frame.projection),entry.box,matrix,false,false);}
 }finally{frame.free();frame.free();scene.free();}
 expect(()=>frame.prepare([])).toThrow('disposed');expect(rust.shelf_live_handles()).toBe(handles);
});
