// @vitest-environment node
import {expect,it} from 'vitest'
import {rustShelf as shelf} from './helpers/rust-shelf-ready.js'
import {rustUI as ui} from './helpers/rust-ui-engine.js'
const books=[{id:'local-A',driveFileId:'file-A'},{id:'local-B',driveFileId:'file-B'}]
const remote=[{id:'drive:file-A',driveFileId:'file-A'},{id:'new-local-B',driveFileId:'file-B'}]
const pose=()=>[2,[1,1000],[['book:local-A',0,[.15,-.2,0,1000],[.02,.2,.15],[.019,.581,-.299,-.011],.2,-.24,-.5,null],['plant:fern',1,[.3,-.25,0,1000],[.1,.1,.15],[.019,.581,-.299,-.011],.31,-.26,.01,'solid-v1:fern']]]
for(const [name,core]of [['UI',ui],['shelf',shelf]]){
 it(`${name}: maps local identities to Drive and retains decorative identities`,()=>{
  const encoded=core.room_physics_for_cloud(JSON.stringify(pose()),books),rows=JSON.parse(encoded)[2]
  expect(rows[0][0]).toBe('book:drive:file-A');expect(rows[1][0]).toBe('plant:fern')
  expect(rows[0][2]).toEqual([.131,.099,0,1]);expect(rows[0][4]).toEqual([0,.562,0,.288]);expect(rows[0].slice(5,8)).toEqual([.181,.059,-.5])
  const decoded=JSON.parse(core.room_physics_for_device(encoded,remote));expect(decoded[2][0][0]).toBe('book:drive:file-A');expect(decoded[2][1][8]).toBe('solid-v1:fern')
  expect(core.room_physics_for_cloud(JSON.stringify(decoded),remote)).toBe(encoded)
 })
 it(`${name}: gives exactly the same manifest after viewport translation and pixel scaling`,()=>{
  const original=pose(),changed=structuredClone(original);changed[1]=[1000,2000,3000]
  for(const row of changed[2]){row[2][0]+=.08;row[2][1]-=.12;row[2][3]=700;row[4]=row[4].map((v,i)=>v+(i<2?.08:-.12));row[5]+=.08;row[6]-=.12}
  expect(core.room_physics_for_cloud(JSON.stringify(changed),books)).toBe(core.room_physics_for_cloud(JSON.stringify(original),books))
 })
 it(`${name}: preserves malformed or legacy data for the solver to validate atomically`,()=>{
  for(const value of [null,'{bad','null','[]',JSON.stringify([1,[],[]])])expect(core.room_physics_for_cloud(value,books)).toBe(value)
 })
}
function fixture(names,scale=1,dx=0,dy=0){
 const solver=new shelf.RustBookGravity(),scene=new shelf.RustScene(600*scale,1200*scale,600*scale,250*scale,false,false,0)
 const inverse=Float64Array.of(0,0,0,1),out=new Float64Array(names.length*4);let clock=0
 return {apply:value=>solver.apply_snapshot(value),restore:value=>solver.restore(value),snapshot:()=>solver.snapshot(),step(frames=1,held=false){
  for(let f=0;f<frames;f++){
   scene.beginEntries(clock,false,1,inverse,1,600*scale,0,18)
   const states=new Float64Array(names.length*37),geometry=new Float64Array(names.length*9)
   names.forEach((name,i)=>{
    const kind=i===2?1:0,height=kind?100:200,x=100+i*40,y=300-height/2
    states.set([kind,0,held?2:0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,(x+dx)*scale,(y+dy)*scale,150*scale,height*scale,150*scale,0],i*37)
    geometry.set([(kind?50:20)*scale,kind,0,1000*scale,dx*scale,(600+dx)*scale,(300+dy)*scale,(10+dy)*scale,0],i*9)
   });solver.step(names,states,geometry,scene,clock,false,out);clock+=1000/60
  }return Array.from(out)
 },free(){solver.free();scene.free()}}
}
it('restores the complete physical room on another device at a different viewport without reseeding or animating it',()=>{
 const a=fixture(['book:local-A','book:local-B','plant:fern']);a.step(600);const saved=a.snapshot();expect(typeof saved).toBe('string');a.free()
 const cloud=ui.room_physics_for_cloud(saved,books),b=fixture(['book:drive:file-A','book:new-local-B','plant:fern'],.7,80,120)
 expect(b.restore(ui.room_physics_for_device(cloud,remote))).toBe(true)
 const after=b.step();expect(after.filter((_,i)=>i%4===3)).toEqual([0,0,0])
 const roundtrip=ui.room_physics_for_cloud(b.snapshot(),remote)
 const original=JSON.parse(cloud)[2],restored=JSON.parse(roundtrip)[2]
 for(let i=0;i<3;i++)for(const field of [5,6,7])expect(restored[i][field]).toBeCloseTo(original[i][field],5)
 expect(b.step(30)).toEqual(after);b.free()
})
it('keeps the same binding design when a Drive copy has a different local ID',()=>{
 const original={id:'local-id',title:'A quiet evening'},copy={...original,id:'drive:123',shelfVisualId:'local-id'}
 expect(shelf.spine_layout(copy)).toEqual(shelf.spine_layout(original))
})
it('adopts a remote resting pose in the live solver and rejects incompatible updates atomically',()=>{
 const f=fixture(['book:local-A']);const before=f.step(600),snapshot=JSON.parse(f.snapshot());snapshot[2][0][7]*=-1
 expect(f.apply(JSON.stringify(snapshot))).toBe(true);const after=f.step();expect(after[0]).toBeCloseTo(-before[0],5);expect(after[1]).toBeCloseTo(before[1],5);expect(after[2]).toBeCloseTo(before[2],5);expect(after[3]).toBe(0)
 expect(f.step(120)).toEqual(after)
 const wrong=structuredClone(snapshot);wrong[2][0][3][0]=.9;expect(f.apply(JSON.stringify(wrong))).toBe(false);expect(f.step()).toEqual(after)
 expect(f.apply('{bad')).toBe(false);expect(f.step()).toEqual(after);f.free()
 const moving=fixture(['book:local-A']);moving.step(1,true);expect(moving.apply(JSON.stringify(snapshot))).toBe(false);moving.free()
})
for(const [name,core]of [['UI',ui],['shelf',shelf]])it(`${name}: preserves distinct UTF-16 book identities in the shared room`,()=>{
 const ids=['bad\ud800','bad\ufffd'],records=ids.map((id,i)=>({id,driveFileId:'file-'+i})),root=pose()
 root[2]=ids.map(id=>{const row=structuredClone(root[2][0]);row[0]='book:'+id;return row})
 const shared=JSON.parse(core.room_physics_for_cloud(JSON.stringify(root),records));expect(shared[2].map(r=>r[0])).toEqual(['book:drive:file-0','book:drive:file-1'])
 const local=JSON.parse(core.room_physics_for_device(JSON.stringify(shared),records));expect(local[2].map(r=>r[0])).toEqual(ids.map(id=>'book:'+id))
})
for(const [name,core]of [['UI',ui],['shelf',shelf]])it(`${name}: derives appearance seeds without changing JavaScript coercion or UTF-16`,()=>{
 const old=book=>{if(!book)return '';if(book.id!=null&&book.id!=='')return String(book.id);if(book.path)return String(book.path);return `${book.title??''}|${book.author??''}`}
 for(const record of [null,undefined,false,0,'',{}, {id:0},{id:false},{id:123n},{id:Symbol('id')},{id:'a\ud800'},{id:'',path:'a/水'},{path:{toString:()=> 'path'}},{title:'Título',author:'Autor'},{title:'\ud800',author:'\ufffd'}])expect(core.book_seed_for(record)).toBe(old(record))
 expect(()=>core.book_seed_for({title:Symbol('title')})).toThrow(TypeError)
 expect(core.book_seed_for({id:'drive:123',shelfVisualId:'origin'})).toBe('origin')
})

it('adopts shared bay-relative poses despite viewport rounding of the semantic placement anchor',()=>{
 const f=fixture(['book:local-A']);f.step(600);const local=f.snapshot(),canonical=JSON.parse(ui.room_physics_for_cloud(local,books))
 canonical[2][0][2][0]+=.00044
 expect(f.apply(ui.room_physics_for_device(JSON.stringify(canonical),books))).toBe(true)
 f.step();const after=JSON.parse(ui.room_physics_for_cloud(f.snapshot(),books))
 expect(after[2][0][5]).toBeCloseTo(canonical[2][0][5],6);expect(after[2][0][6]).toBeCloseTo(canonical[2][0][6],6)
 const stale=JSON.parse(local);stale[2][0][2][0]+=.00044;expect(f.apply(JSON.stringify(stale))).toBe(false);f.free()
})

it('treats different semantic anchors as the same shared physical room, retaining real position/dimension changes',()=>{
 const a=ui.room_physics_for_cloud(JSON.stringify(pose()),books),b=JSON.parse(a);b[2][0][2][0]+=.00044
 expect(ui.room_physics_equivalent(a,JSON.stringify(b))).toBe(true)
 b[2][0][5]+=.0001;expect(ui.room_physics_equivalent(a,JSON.stringify(b))).toBe(false)
 b[2][0][5]-=.0001;b[2][0][3][0]+=.0001;expect(ui.room_physics_equivalent(a,JSON.stringify(b))).toBe(false)
 expect(ui.room_physics_equivalent('{bad','null')).toBe(false)
})
