// @vitest-environment node
import {expect,it} from 'vitest';
import * as THREE from 'three';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {createFoliageFrame} from './helpers/foliage-frame.js';
import {createSceneEntryFrame,ENTRY_OUTPUT} from '../../src/js/scene-entry-frame.js';
import {prepareAreas} from './helpers/reference-foliage-areas.js';

// A plant's foliage is posed in one call that takes the row's projected rectangle from the entry
// arena (RustSceneEntryFrame#foliagePose, rust-ui/src/scene_exclusions.rs); the scene holds the
// foliage's natives itself. The adapter the app had until 1.8.1 (tests/unit/helpers/foliage-frame.js),
// which copied the model's matrix, the room's turn and the entry's rectangle object into the
// state's view, must say "project the leaves again" in the same frames and leave the same clips.
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});

it('poses a plant\'s foliage from the arena as the adapter did from the entry\'s rectangle',()=>{
 let moved=0,kept=0,clipped=0,unclipped=0,replaced=0,odd=0,single=0;
 for(let trial=0;trial<12;trial++){
  const next=random(trial*613+29),count=6;
  const host=createFoliageFrame(rust),live=new rust.RustFoliageFrame(),entries=createSceneEntryFrame(rust);
  const turn=new THREE.Quaternion();
  const plants=Array.from({length:count},(_,row)=>({row,model:new THREE.Object3D(),before:host.createState(),after:new rust.RustFoliageState(),posed:null,rect:rect(row*40,10,150,220)}));
  try{
   entries.prepare(count);
   for(let frame=0;frame<400;frame++){
    const label=`trial ${trial} frame ${frame}`;
    // The room turns, or one number of its turn alone moves.
    const turned=next();
    if(turned<.05)turn.setFromEuler(new THREE.Euler(next()*.2,next()*2,0));
    else if(turned<.1){const axis=['x','y','z','w'][Math.floor(next()*4)];turn[axis]+=1e-3;single++;}
    // The other entries' rectangles: sometimes none, sometimes reordered, sometimes not a number.
    if(next()<.25){
     const areas=Array.from({length:Math.floor(next()*9)},(_,i)=>rect(i*23+next()*8,20+next()*30,next()<.05?NaN:28,90));
     prepareAreas(host,areas);prepareAreas({native:live},areas);
    }
    for(const plant of plants){
     const dice=next();
     if(dice<.1){plant.model.position.set(next()*300,-next()*900,next()*30);plant.model.updateMatrix();}
     else if(dice<.14){plant.model=plant.model.clone();replaced++;}
     else if(dice<.3)plant.rect=rect(next()*400,next()*600,100+next()*200,150+next()*300);
     else if(dice<.33){plant.rect=rect([NaN,-0,0,Infinity][Math.floor(next()*4)],next()*10,next()<.5?0:120,200);odd++;}
     // The arena's row holds what the entry's rectangle object held (bookshelf-scene.js copied it from there).
     entries.refresh();
     const {left,right,top,bottom,width,height}=plant.rect;
     entries.output.set([left,right,top,bottom,width,height],plant.row*ENTRY_OUTPUT+58);
     const expected=plant.before.pose(plant.model,turn,plant.rect);
     entries.leaf.set(plant.model.matrix.elements);
     const actual=entries.lamp.foliagePose(plant.after,plant.row,turn.x,turn.y,turn.z,turn.w,plant.posed!==plant.model);
     if(actual)plant.posed=plant.model;
     expect(actual,label).toBe(expected);
     const clips=[plant.before.clip(),plant.after.clip(live)];
     expect(clips[1],label).toBe(clips[0]);
     if(expected)moved++;else kept++;
     if(clips[0])clipped++;else unclipped++;
    }
   }
  }finally{for(const plant of plants)plant.after.free();host.free();live.free();entries.free();}
 }
 expect(moved).toBeGreaterThan(2500);expect(kept).toBeGreaterThan(10000);expect(clipped).toBeGreaterThan(5000);expect(unclipped).toBeGreaterThan(5000);
 expect(replaced).toBeGreaterThan(500);expect(single).toBeGreaterThan(150);expect(odd).toBeGreaterThan(400);
});
