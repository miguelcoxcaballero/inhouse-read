import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';

// A frame's first step, the bin's, the shadow's refit and the painted view are one call each
// (rust-ui/src/scene_begin.rs). A twin view is driven through the same random session with the
// host's former sequence of single questions (bookshelf-scene.js draw, updateTrash and
// canDeferModalPaint as of 1.7.334, frozen below; each of those calls is itself guarded against
// the frozen JavaScript in scene-view-wasm): every answer and every state must be the same, bit for bit.
let seed=11;
const random=()=>(seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296,chance=p=>random()<p;
const pick=list=>list[Math.floor(random()*list.length)];
const bits=value=>{const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);return view.getBigUint64(0);};

function frozenFrame(scene,now,reduced,held){
 const furnitureMoving=scene.turning||scene.reordering;
 let scrollPan=null,amount=null,ended=false;
 if(scene.turning)scrollPan=scene.stepTurn(now);
 if(scene.reordering){amount=scene.stepReorder(now);if(!scene.reordering)ended=true;}
 const rests=scrollPan===null&&scene.progress===1;
 const viewHidden=scene.trashViewHidden();
 if(viewHidden)scene.trashReset();
 const binMoving=scene.trashStep(now,reduced);
 const forceRefit=scene.shadowRefit&&!scene.moving;
 if(!scene.moving)scene.shadowRefit=false;
 // canDeferModalPaint's comparison with the view of the last painted room, then that room is painted.
 const painted=held.view;
 const same=Boolean(painted)&&!(painted.progress!==scene.progress||painted.inspectionZoom!==scene.zoom||painted.panX!==scene.panX||painted.panY!==scene.panY);
 if(held.paints)held.view={progress:scene.progress,inspectionZoom:scene.zoom,panX:scene.panX,panY:scene.panY};
 return {furnitureMoving,scrollPan,amount,ended,rests,viewHidden,binMoving,forceRefit,same};
}
function frame(scene,now,reduced,held){
 const begun=scene.beginFrame(now),furnitureMoving=Boolean(begun&3);
 const scrollPan=begun&1?scene.turnScroll:null,amount=begun&2?scene.reorderLeft:null,ended=Boolean(begun&4);
 const rests=!(begun&1)&&Boolean(begun&8);
 const bin=scene.trashBegin(now,reduced);
 const forceRefit=scene.takeRefit();
 const same=scene.paintedSame();
 if(held.paints)scene.keepPainted();
 return {furnitureMoving,scrollPan,amount,ended,rests,viewHidden:Boolean(bin&1),binMoving:bin>1,forceRefit,same};
}
const state=scene=>[scene.progress,scene.zoom,scene.panX,scene.panY,scene.trashOpenness,scene.reorderStarted].map(bits)
 .concat([scene.turning,scene.reordering,scene.moving,scene.shadowRefit,scene.trashHover,scene.trashEasing,scene.isometric,scene.hasDrop]);

it('begins 400 random sessions of frames exactly as the single questions did',()=>{
 let turned=0,reordered=0,ended=0,refits=0,lids=0,sames=0,rested=0;
 for(let session=0;session<400;session++){
  const isometric=chance(.5),scroll=pick([0,120,333.5]);
  const twins=[0,1].map(()=>new rust.RustScene(390,700,390,162.5,false,isometric,scroll));
  const held=[{view:null,paints:false},{view:null,paints:false}];
  let now=1000+random()*50;
  try{
   for(let step=0;step<120;step++){
    now+=pick([0,4,16.7,16.7,33,80,400,-5,NaN]);
    const act=Math.floor(random()*12),reduced=chance(.1),flag=chance(.5),other=chance(.7);
    const zoom=pick([1,1.5,3]),panX=pick([0,12,-40]),panY=pick([0,-7,25]),scrollTop=pick([0,40,160]);
    for(const scene of twins){
     if(act===0)scene.setMode(flag,other,now,scrollTop);
     else if(act===1)scene.beginReorder(now);
     else if(act===2)scene.setInspection(zoom,panX,panY,flag);
     else if(act===3)scene.trashSetHover(flag,other,now);
     else if(act===4)scene.shadowRefit=true;
     else if(act===5)scene.setDrop(flag,0,.5,false,3);
    }
    held[0].paints=held[1].paints=chance(.6);
    const expected=frozenFrame(twins[0],now,reduced,held[0]),actual=frame(twins[1],now,reduced,held[1]);
    for(const key of ['scrollPan','amount'])if(expected[key]!==null&&actual[key]!==null){expect(bits(actual[key])).toBe(bits(expected[key]));expected[key]=actual[key]=0;}
    expect(actual).toEqual(expected);
    expect(state(twins[1])).toEqual(state(twins[0]));
    turned+=expected.scrollPan!==null;reordered+=expected.amount!==null;ended+=expected.ended;refits+=expected.forceRefit;lids+=expected.binMoving;sames+=expected.same;rested+=expected.rests;
   }
  }finally{for(const scene of twins)scene.free();}
 }
 // The session really exercises every branch.
 for(const count of [turned,reordered,ended,refits,lids,sames,rested])expect(count).toBeGreaterThan(50);
});
