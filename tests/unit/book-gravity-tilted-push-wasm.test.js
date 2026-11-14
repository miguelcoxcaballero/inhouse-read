// @vitest-environment node
import {expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {rustShelf} from './helpers/rust-shelf-ready.js'
function fixture(rows,metal=false,animated=false){
 const solver=new rustShelf.RustBookGravity(),scene=new rustShelf.RustScene(600,1200,600,250,metal,false,0);
 let clock=0;const previous=new Map();
 return {rows,decoration:(...args)=>solver.decoration(...args),pause:()=>solver.pause(),snapshot:()=>solver.snapshot(),restore:value=>solver.restore(value),drop:(key,x,row=0,floor=300,ceiling=10)=>[...solver.drop_position(key,Float64Array.of(row,x,0,600,floor,ceiling,1000))],step(frames=1,reduced=false,frameMs=1000/60){let output;
  for(let frame=0;frame<frames;frame++){
   scene.beginEntries(clock,reduced,1,new Float64Array([0,0,0,1]),1,600,0,18);
   const states=new Float64Array(rows.length*37),geometry=new Float64Array(rows.length*9);
   rows.forEach((b,i)=>{
    const height=b.height??200,y=(b.floor??300)-height/2;
    states.set([b.kind===3?2:b.kind??0,b.kind===3?1:0,b.flags??0,b.drag??0,b.dragY??0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,y,150,height,150,0],i*37);
    states[i*37+13]=b.previewX??0;states[i*37+14]=b.previewY??0;states[i*37+21]=b.offsetX??0;states[i*37+22]=b.offsetY??0;
    if(animated&&previous.has(b.id))states.set(previous.get(b.id).subarray(5,23),i*37+5);
    geometry.set([b.width??20,b.kind??0,b.shelf??0,1000,0,600,b.floor??300,b.ceiling??((b.floor??300)-290+((b.shelf??0)>0?15/.65-10:0)),b.grip??0],i*9);
   });
   output=new Float64Array(rows.length*4);solver.step(rows.map(b=>b.id),states,geometry,scene,clock,reduced,output);clock+=frameMs;
   if(animated)rows.forEach((b,i)=>previous.set(b.id,states.slice(i*37,i*37+37)));
  }
  return rows.map((b,i)=>({angle:output[i*4],x:b.x+output[i*4+1],y:(b.floor??300)-(b.height??200)/2-output[i*4+2],active:output[i*4+3]}));
 },free(){solver.free();scene.free()}};
}
const book=(id,x,extra={})=>({id,x,...extra});

it('recovers deliberate contacts after a neighbour falls underneath a straightening pickup',()=>{
 const f=fixture([book('hand',80),book('near',260),book('support',340,{kind:1,width:60,height:100})]);
 const initial=f.step(600);expect(initial.every(b=>b.active===0)).toBe(true);f.snapshot();
 f.rows[0].flags=2;const upright=f.step(60);expect(Math.abs(upright[0].angle)).toBeLessThan(.06);expect(Math.abs(upright[1].angle)).toBeGreaterThan(1.4);
 for(let frame=1;frame<=120;frame++){f.rows[0].drag=frame*.5;f.step();}
 const pushed=f.step(60);expect(pushed[1].x-upright[1].x).toBeGreaterThan(8);
 Object.assign(f.rows[0],{flags:0,x:140,drag:0});const settled=f.step(600);
 expect(settled.every(b=>b.active===0)).toBe(true);expect(settled[2]).toEqual(initial[2]);
 for(const b of settled.slice(0,2)){expect(b.y+100*Math.abs(Math.cos(b.angle))+10*Math.abs(Math.sin(b.angle))).toBeLessThan(300.8);}
 f.free();
});
it('allows pots to touch while their wider foliage overlaps, without moving the other pot',()=>{
 const f=fixture([book('left',250,{kind:1,width:180,height:160}),book('right',450,{kind:1,width:180,height:160})]);
 for(const id of ['left','right'])f.decoration(id,1,'muskot','muskot',Float64Array.of(.03,.07,.16,0));
 const rest=f.step(600);f.rows[1].flags=2;f.step(60);
 expect(f.drop('right',320)[0]).toBeCloseTo(320,2);
 const touching=f.drop('right',285);expect(touching).toHaveLength(1);expect(touching[0]).toBeGreaterThan(309);expect(touching[0]).toBeLessThan(312);
 expect(f.step()[0]).toEqual(rest[0]);f.free();
});
it('uses the actual empty space between tripod legs for a short book drop',()=>{
 const f=fixture([book('hand',100,{flags:2,width:10,height:80,shelf:1,floor:620}),book('lamp',300,{kind:2,width:180,height:280})]);
 f.decoration('lamp',2,'','',Float64Array.of(0,0,0,.001));const before=f.step(600);
 expect(f.drop('hand',320)[0]).toBeCloseTo(320,2);expect(f.step()[1]).toEqual(before[1]);f.free();
});
it('rejects a physically full destination bay without moving its occupants',()=>{
 const f=fixture([book('hand',100,{flags:2,width:20,height:160,shelf:1,floor:620}),book('full',300,{kind:1,width:560,height:280})]);
 const before=f.step(120);expect(f.drop('hand',300)).toEqual([]);expect(f.step()[1]).toEqual(before[1]);f.free();
});

it('resolves a fresh book inside a real pot without wedging it against the cabinet post',()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/decor-initial-overlap.json',import.meta.url),'utf8'));
 const scene=new rustShelf.RustScene(...input.scene),solver=new rustShelf.RustBookGravity(),geometry=Float64Array.from(input.geometry),out=new Float64Array(input.keys.length*4);
 let decoration=0;for(let i=0;i<input.keys.length;i++)if(input.geometry[i*9+1]===1){const d=input.decor[decoration++];solver.decoration(input.keys[i],d.kind,d.pot,d.profile,Float64Array.from(d.values));}
 const advance=frames=>{for(let frame=0;frame<frames;frame++){const states=Float64Array.from(input.states.map(v=>v===null?NaN:v));scene.beginEntries(frame*1000/60,false,input.zoom,Float64Array.of(0,0,0,1),1,390,0,44);solver.step(input.keys,states,geometry,scene,frame*1000/60,false,out);}};
 advance(3000);expect(input.keys.filter((_,i)=>out[i*4+3]!==0)).toEqual([]);
 const index=input.keys.indexOf('book:rust-placement:4'),state=input.states.slice(index*37,index*37+37),g=input.geometry.slice(index*9,index*9+9),angle=out[index*4];
 const toe=state[24]-out[index*4+2]+state[26]/2*Math.abs(Math.cos(angle))+g[0]/2*Math.abs(Math.sin(angle));
 expect(toe).toBeGreaterThan(g[6]-1.5);expect(toe).toBeLessThan(g[6]+.8);
 expect(typeof solver.snapshot()).toBe('string');solver.free();scene.free();
});

it('lets a real pot and thin-book contact stack sleep together after a cross-shelf drop',()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/decor-drop-on-stack.json',import.meta.url),'utf8'));
 const scene=new rustShelf.RustScene(...input.scene),solver=new rustShelf.RustBookGravity();
 const register=solver=>{for(const d of input.decor)solver.decoration(d.key,d.kind,d.pot,d.profile,Float64Array.from(d.values));};register(solver);expect(solver.restore(input.snapshot)).toBe(true);
 const step=(solver,frame)=>{const b=frame.begin,states=Float64Array.from(frame.states.map(v=>v===null?NaN:v)),out=new Float64Array(frame.keys.length*4);scene.beginEntries(b[0],b[1],b[2],Float64Array.from(b.slice(3,7)),...b.slice(7));solver.step(frame.keys,states,Float64Array.from(frame.geometry),scene,frame.now,false,out);return [...out];};
 for(const frame of input.frames)step(solver,frame);
 const last=input.frames.at(-1);let now=last.now,out;
 for(let frame=0;frame<1800;frame++){now+=1000/60;out=step(solver,{...last,now,begin:[now,...last.begin.slice(1)]});}
 expect(last.keys.filter((_,i)=>out[i*4+3]!==0)).toEqual([]);const saved=solver.snapshot();expect(typeof saved).toBe('string');solver.free();
 const reopened=new rustShelf.RustBookGravity();register(reopened);expect(reopened.restore(saved)).toBe(true);
 const restored=step(reopened,{...last,now:now+1000/60,begin:[now+1000/60,...last.begin.slice(1)]});
 // Reconstructing the quaternion can round its f32 angle by one ULP
 // (1.19e-7 rad in this capture). Translation and sleeping flags stay exact.
 for(let i=0;i<out.length;i++){if(i%4===0)expect(restored[i]).toBeCloseTo(out[i],6);else expect(restored[i]).toBe(out[i]);}
 reopened.free();scene.free();
});
