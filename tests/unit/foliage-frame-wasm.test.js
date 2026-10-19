// @vitest-environment node
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { rustShelf, shelfWasm } from './helpers/rust-shelf-ready.js';
import { foliageClip } from './helpers/reference-scene-math.js';
import { createFoliageFrame } from '../../src/js/foliage-frame.js';

const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
function original(){
  let model=null,pose=[],bounds,inputs=[];
  return {step(next,rotation,area,excluded){
    const elements=next.matrix.elements;
    let moved=model!==next||rotation.x!==pose[16]||rotation.y!==pose[17]||rotation.z!==pose[18]||rotation.w!==pose[19];
    for(let i=0;i<16&&!moved;i++)moved=elements[i]!==pose[i];
    if(moved){model=next;bounds={...area};pose=[...elements,rotation.x,rotation.y,rotation.z,rotation.w];}
    return {moved,clip:foliageClip(inputs,bounds,area,excluded)||''};
  }};
}
it('preserves pose invalidation and exact clip paths through pan, zoom, turns and reordered occluders',()=>{
  const frame=createFoliageFrame(rustShelf),rotation=new THREE.Quaternion();
  const plants=Array.from({length:8},(_,i)=>({model:new THREE.Object3D(),state:frame.createState(),reference:original(),i}));
  let changed=0,steady=0;
  try{
    for(let tick=0;tick<700;tick++){
      const zoom=1+(Math.floor(tick/9)%4)*.37,dx=Math.floor(tick/3)%7,dy=Math.floor(tick/6)%9;
      if(tick%60===0)rotation.setFromEuler(new THREE.Euler(tick*.001,tick*.003,0));
      let areas=Array.from({length:Math.floor(tick/25)%17},(_,i)=>rect(i*17+dx,19+dy,28,80+i));
      if(tick%47===0)areas.reverse();
      frame.prepare(areas);
      for(const plant of plants){
        if(tick%53===0){plant.model.position.set(plant.i,tick*.13,0);plant.model.updateMatrix();}
        if(tick===371)plant.model=plant.model.clone();
        const area=rect(plant.i*13+dx,dy,150*zoom,220*zoom);
        const expected=plant.reference.step(plant.model,rotation,area,areas);
        expect(plant.state.pose(plant.model,rotation,area)).toBe(expected.moved);
        expect(plant.state.clip()).toBe(expected.clip);
        if(expected.clip)changed++;else steady++;
      }
    }
    expect(changed).toBeGreaterThan(1000);expect(steady).toBeGreaterThan(1000);
  }finally{frame.free();}
});
it('keeps NaN and signed-zero equality and degenerate rectangle behavior',()=>{
  const frame=createFoliageFrame(rustShelf),state=frame.createState(),baseline=original(),model=new THREE.Object3D(),q=new THREE.Quaternion();
  try{
    for(const value of [0,-0,NaN,NaN,Infinity,-Infinity,1e-300,1e20,5]){
      model.matrix.elements[12]=value;
      const area=rect(value,0,value===5?100:0,100),occluders=[rect(0,0,50,50)];
      frame.prepare(occluders);const expected=baseline.step(model,q,area,occluders);
      expect(state.pose(model,q,area)).toBe(expected.moved);expect(state.clip()).toBe(expected.clip);
    }
    const area=rect(0,0,100,200),occluders=[rect(NaN,20,30,60)];
    for(let tick=0;tick<3;tick++){
      frame.prepare(occluders);
      for(let read=0;read<2;read++){
        const expected=baseline.step(model,q,area,occluders);
        expect(state.pose(model,q,area)).toBe(expected.moved);expect(state.clip()).toBe(expected.clip);
      }
    }
  }finally{frame.free();}
});
it('keeps an inactive plant cache valid when occluders move away and return before it is shown',()=>{
  const frame=createFoliageFrame(rustShelf),state=frame.createState(),model=new THREE.Object3D(),q=new THREE.Quaternion();
  const area=rect(0,0,200,300),occluders=[rect(10,20,30,80)];
  try{
    frame.prepare(occluders);state.pose(model,q,area);expect(state.clip()).not.toBe('');
    frame.prepare([rect(120,20,30,80)]);frame.prepare(occluders);
    expect(state.pose(model,q,area)).toBe(false);expect(state.clip()).toBe('');
  }finally{frame.free();}
});
it('rebinds views after shared memory growth and releases state exactly once',()=>{
  const handles=rustShelf.shelf_live_handles(),frame=createFoliageFrame(rustShelf),state=frame.createState();
  const model=new THREE.Object3D(),q=new THREE.Quaternion(),area=rect(10,20,200,300),baseline=original();
  frame.prepare([]);shelfWasm.memory.grow(1);
  let expected=baseline.step(model,q,area,[]);
  expect(state.pose(model,q,area)).toBe(expected.moved);shelfWasm.memory.grow(1);expect(state.clip()).toBe(expected.clip);
  const occluders=Array.from({length:90},(_,i)=>rect(i*2,i,12,80));
  frame.prepare(occluders);shelfWasm.memory.grow(1);expected=baseline.step(model,q,area,occluders);
  expect(state.pose(model,q,area)).toBe(expected.moved);expect(state.clip()).toBe(expected.clip);
  state.free();state.free();expect(()=>state.clip()).toThrow('disposed');
  for(let i=0;i<500;i++){const transient=frame.createState();transient.pose(model,q,area);transient.clip();transient.free();}
  const unfreed=frame.createState();frame.free();frame.free();unfreed.free();
  expect(()=>frame.prepare([])).toThrow('disposed');expect(()=>unfreed.clip()).toThrow('disposed');
  expect(rustShelf.shelf_live_handles()).toBe(handles);
});
