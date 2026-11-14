// @vitest-environment node
import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {createSceneEntryFrame,ENTRY_STATE} from '../../src/js/scene-entry-frame.js';
import {previewOffset,previewTarget} from './helpers/reference-scene-math.js';

// A drag move's placement previews are advanced over the entry arena's own preview columns
// (RustSceneEntryFrame#preview). The frozen original (reference-bookshelf-scene.js
// previewPlacements, with reference-scene-math.js's previewOffset and previewTarget) kept a
// preview object per entry: after every move the eight numbers of every entry and the answer
// "did anything change" must be the same bits.
const S=ENTRY_STATE;
function random(seed){let s=seed>>>0;return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rows=[{top:20,bottom:220,left:12},{top:260,ceiling:240,bottom:460},{top:500,bottom:700,left:6,ceiling:null},{top:740,bottom:940.5,left:-3.25}];
const entryData=(i,r)=>({key:`k${i}`,kind:i%7===3?'plant':i%5===2?'lamp':undefined,mount:i%10===2?'undershelf':undefined,
 x:r()*900-40,y:r()*900+90,height:60+r()*200});

it.each([1,2,3,4,5,6])('keeps every preview of session %i equal to the frozen host loop',seed=>{
 const r=random(seed*7919),frame=createSceneEntryFrame(rust);
 let compared=0,moved=0,placedTotal=0;
 for(let layout=0;layout<4;layout++){
  const count=layout===3?0:3+Math.floor(r()*90);
  const frozen=Array.from({length:count},(_,i)=>({...entryData(i,r),preview:{x:0,y:0,fromX:0,fromY:0,targetX:0,targetY:0,started:0,active:false}}));
  const live=frozen.map(e=>({...e,preview:undefined,row:-1}));
  frame.bind(live,true);
  let now=1000+r()*5000,batch=new Float64Array(0);
  for(let tick=0;tick<260;tick++){
   now+=r()<.1?0:r()<.2?400:r()*40;
   const reduced=r()<.08;
   // What the arrangement places: some entries, sometimes none, with rows that do not exist and
   // centres that are not numbers (both leave the entry heading back to rest).
   const objects=r()<.12?[]:frozen.filter(()=>r()<.6).map(e=>({key:r()<.05?`${e.key}x`:e.key,shelf:Math.floor(r()*5),
    center:r()<.06?NaN:r()<.03?'70.5':r()<.03?undefined:r()*700}));
   const dragged=r()<.3?undefined:r()<.5?frozen[Math.floor(r()*count)]?.key:Math.floor(r()*count);
   const placements=new Map(objects.map(object=>[String(object.key),object]));
   // The frozen loop.
   let expected=false;
   for(const entry of frozen){
    const objectKey=String(entry.key),placement=objectKey!==String(dragged)?placements.get(objectKey):null;
    const row=placement&&rows[placement.shelf],center=Number(placement?.center);
    const goal=row&&Number.isFinite(center)?previewTarget(row,center,entry):{x:0,y:0};
    expected=previewOffset(entry.preview,goal.x,goal.y,now,reduced)||expected;
   }
   // The host's side of the arena call, as bookshelf-scene.js packs it.
   if(batch.length<count*10)batch=new Float64Array(count*10);
   let used=0;
   for(let index=0;index<count;index++){
    const entry=live[index],objectKey=String(entry.key),placement=objectKey!==String(dragged)?placements.get(objectKey):null;
    const row=placement&&rows[placement.shelf],center=Number(placement?.center);
    if(row&&Number.isFinite(center)){
     const undershelf=entry.kind==='lamp'&&entry.mount==='undershelf';
     batch[used]=index;batch[used+1]=row.left||0;batch[used+2]=undershelf?row.ceiling??row.top:0;batch[used+3]=row.bottom;
     batch[used+4]=center;batch[used+5]=entry.x;batch[used+6]=entry.y;batch[used+7]=entry.height;batch[used+8]=undershelf?1:0;used+=10;
    }
   }
   placedTotal+=used/10;
   const changed=frame.preview(batch.subarray(0,used),now,reduced);
   expect(changed,`seed ${seed} layout ${layout} tick ${tick}`).toBe(expected);
   if(changed)moved++;
   frame.refresh();
   for(let index=0;index<count;index++){
    const p=frozen[index].preview,at=index*S+13,state=frame.state;
    const wanted=[p.x,p.y,p.fromX,p.fromY,p.targetX,p.targetY,p.started,p.active?1:0];
    for(let field=0;field<8;field++)if(!Object.is(state[at+field],wanted[field]))
     throw new Error(`seed ${seed} layout ${layout} tick ${tick} entry ${index} field ${field}: ${state[at+field]} is not ${wanted[field]}`);
    compared++;
   }
   // Nothing but the preview columns is written.
   if(tick%50===0)for(let index=0;index<count;index++)for(let column=0;column<S;column++){
    if(column>=13&&column<=20||column===71||column===73)continue;
    if(frame.state[index*S+column]!==0)throw new Error(`column ${column} of entry ${index} was written`);
   }
  }
 }
 frame.free();
 expect(compared).toBeGreaterThan(8000);expect(moved).toBeGreaterThan(300);expect(placedTotal).toBeGreaterThan(2000);
});

it('advances an active preview written with another truthy flag and ignores a list that names no row',()=>{
 const frame=createSceneEntryFrame(rust),live=[{row:-1},{row:-1}];
 frame.bind(live,true);
 frame.state.set([4,5,1,2,9,7,100,3],13);
 const p={x:4,y:5,fromX:1,fromY:2,targetX:9,targetY:7,started:100,active:true};
 // A row beyond the arena and one out of order are not this entry's: both head back to rest.
 expect(frame.preview(Float64Array.of(7,0,0,200,50,10,20,30,0,0, 0,0,0,200,50,10,20,30,0,0),165,false)).toBe(previewOffset(p,0,0,165,false));
 frame.refresh();
 expect([...frame.state.subarray(13,21)]).toEqual([p.x,p.y,p.fromX,p.fromY,p.targetX,p.targetY,p.started,p.active?1:0]);
 frame.free();
});
