import {afterEach,expect,it,vi} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import * as reference from './helpers/reference-scene-events.js';

// The shelf scene's recipes that follow an event (rust-ui/src/scene_events.rs), each against its frozen
// JavaScript original (helpers/reference-scene-events.js) on equal inputs: the same stored room, the same
// calls with the same arguments in the same order and in the same microtask, the same numbers (Object.is).
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
const KEY='inhouse-read-shelf-physics-v1';

// A solver whose books have come to rest.
function room(books){
 const solver=new rust.RustBookGravity(),scene=new rust.RustScene(600,1200,600,250,false,false,0);
 let clock=0;
 for(let frame=0;frame<600;frame++){
  scene.beginEntries(clock,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
  const states=new Float64Array(books.length*37),geometry=new Float64Array(books.length*9);
  books.forEach((b,i)=>{
   states.set([0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,300-100,150,200,150,0],i*37);
   geometry.set([b.width??20,0,0,1000,0,600,300,10,0],i*9);
  });
  solver.step(books.map(b=>b.id),states,geometry,scene,clock,false,new Float64Array(books.length*4));clock+=1000/60;
 }
 return {solver,scene,free(){solver.free();scene.free();}};
}

it('stores and acknowledges a room at rest exactly as the scene did',()=>{
 const books=[{id:'book:a',x:80},{id:'book:b',x:260},{id:'book:c',x:420,width:34}],records=[{id:'a'},{id:'b'},{id:'c'}];
 const fixture=room(books);
 try{
  const saved=fixture.solver.snapshot();
  expect(typeof saved).toBe('string');
  const canonical=rust.room_physics_canonical(saved,records);
  const nudged=JSON.parse(canonical);nudged[2][0][5]+=1e-7;
  const moved=JSON.parse(canonical);moved[2][0][5]+=.05;
  const stored=[null,'',canonical,JSON.stringify(nudged),JSON.stringify(moved),'{bad','[]'];
  let rewrites=0,kept=0;
  for(const before of stored)for(const interacted of [false,true])for(const room of [saved,canonical,'{bad',null,undefined])for(const failure of ['','store','acknowledge']){
   const run=save=>{
    localStorage.clear();if(before!==null)localStorage.setItem(KEY,before);
    const calls=[],acknowledge=value=>{calls.push(value);if(failure==='acknowledge')throw new Error('acknowledge');};
    const store=vi.spyOn(Storage.prototype,'setItem');
    if(failure==='store')store.mockImplementation(()=>{throw new Error('quota');});
    let thrown='';
    try{save(acknowledge);}catch(error){thrown=String(error?.message??error);}
    const writes=store.mock.calls.map(call=>[...call]);store.mockRestore();
    return {calls,thrown,writes,after:localStorage.getItem(KEY)};
   };
   const expected=run(acknowledge=>reference.roomSave(rust,room,records,KEY,interacted,acknowledge));
   const actual=run(acknowledge=>rust.scene_room_save(room,records,KEY,interacted,acknowledge));
   expect(actual).toEqual(expected);
   if(expected.writes.length)rewrites++;else kept++;
  }
  expect(rewrites).toBeGreaterThan(50);expect(kept).toBeGreaterThan(10);
 }finally{fixture.free();}
});

it('prepares a resting book\'s presentation in the same order and the same microtasks',async()=>{
 const phases=['true','false','undefined','promise true','promise false','promise late','reject','throw','thenable','thenable reject'];
 const details=['absent','not a function',...phases],owners=['yes','no','throws','leaves'];
 const answer=(kind,log,name)=>{
  log(name);
  switch(kind){
   case 'true':return true;case 'false':return false;case 'undefined':return undefined;
   case 'promise true':return Promise.resolve(1);case 'promise false':return Promise.resolve(0);
   case 'promise late':return new Promise(resolve=>{queueMicrotask(()=>queueMicrotask(()=>resolve('late')));});
   case 'reject':return Promise.reject(new Error(name));
   case 'throw':throw new Error(name);
   case 'thenable':return {then(resolve){log(`${name} then`);resolve(true);}};
   default:return {then(_,reject){log(`${name} then`);reject(`${name} refused`);}};
  }
 };
 async function run(prepare,phase,detail,owner){
  const events=[];let tick=0,asked=0;
  const log=text=>events.push(`${tick}:${text}`);
  const warn=vi.spyOn(console,'warn').mockImplementation((...args)=>log(`warn ${args.map(arg=>arg?.message??String(arg)).join(' | ')}`));
  const idle=()=>{},current=()=>{
   log('current');
   if(owner==='throws')throw new Error('current');
   return owner==='yes'||owner==='leaves'&&++asked===1;
  };
  const userData={preparePresentation(slice,owned){expect(this).toBe(userData);expect(slice).toBe(idle);expect(owned).toBe(current);return answer(phase,log,'resting');}};
  if(detail==='not a function')userData.prepareDetailPresentation='soon';
  else if(detail!=='absent')userData.prepareDetailPresentation=function(slice,owned){
   expect(this).toBe(userData);expect(slice).toBe(idle);expect(owned).toBe(current);
   // Its own check of the owner, as the real model makes.
   owned();return answer(detail,log,'detail');
  };
  prepare(userData,idle,current,()=>log('retry'));
  log('returned');
  for(tick=1;tick<12;tick++)await Promise.resolve();
  warn.mockRestore();
  return events;
 }
 let retried=0,completed=0;
 for(const phase of phases)for(const detail of details)for(const owner of owners){
  const expected=await run((data,idle,current,retry)=>reference.prepareResting({userData:data},idle,current,retry),phase,detail,owner);
  const actual=await run((data,idle,current,retry)=>rust.scene_prepare_resting(data,idle,current,retry),phase,detail,owner);
  expect(actual,`${phase} / ${detail} / ${owner}`).toEqual(expected);
  if(expected.some(event=>event.endsWith(':retry')))retried++;else completed++;
 }
 expect(retried).toBeGreaterThan(200);expect(completed).toBeGreaterThan(20);
});

it('asks the solver for a dropped object\'s place with the same numbers',()=>{
 const books=[{id:'book:a',x:80},{id:'book:b',x:260},{id:'book:c',x:420,width:34}];
 const fixture=room(books);
 try{
  let seed=11;const random=()=>(seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296,pick=list=>list[Math.floor(random()*list.length)];
  let placed=0,refused=0;
  for(let round=0;round<3000;round++){
   const row={left:pick([undefined,0,0,12,null]),right:pick([undefined,600,600,588,null,5]),padding:pick([undefined,undefined,16,0,8,400]),
    bottom:pick([300,300,300,undefined,NaN]),ceiling:pick([10,10,undefined,null]),top:pick([10,20,undefined])};
   const position={shelf:pick([0,0,0,1,-1,.5,'0']),x:pick([random(),random(),0,1,-0,NaN,'0.25']),mount:pick(['standing',undefined])};
   const entry={key:pick(['book:a','book:b','book:c','book:none',undefined])},width=600,pixelsPerMetre=pick([1000,1000,650,0]);
   const expected=reference.resolveDrop(fixture.solver,entry,position,row,width,pixelsPerMetre);
   // The scene's lines around the native call.
   const left=row.left||0,padding=row.padding??16;
   const x=rust.scene_drop_x(fixture.solver,entry.key,position.shelf,position.x,left,row.right??width,padding,row.bottom,row.ceiling??row.top,pixelsPerMetre);
   const actual=x===undefined?null:{...position,x};
   if(expected===null){expect(actual).toBe(null);refused++;}
   else{expect(Object.keys(actual)).toEqual(Object.keys(expected));for(const key of Object.keys(expected))expect(Object.is(actual[key],expected[key]),key).toBe(true);placed++;}
  }
  expect(placed).toBeGreaterThan(200);expect(refused).toBeGreaterThan(300);
 }finally{fixture.free();}
});
