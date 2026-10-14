import { createShelfPlacementPreview,SHELF_PREVIEW_MIN_OBJECTS,SHELF_PREVIEW_DIRECT_MOVES } from '../../src/js/shelf-placement-preview.js';
import { moveShelfDecoration } from '../unit/helpers/reference-shelf-decoration-layout.js';
import { shelfSessionFixture } from './shelf-placement-session-cases.mjs';
import { canonicalPlacement,placementChecksum } from './shelf-placement-benchmark.mjs';
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof data==='string'?new TextEncoder().encode(data):data)),n=>n.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>{if(canonicalPlacement(a)!==canonicalPlacement(b))throw new Error('Complete drag snapshot output differs');};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
// The placement has no JavaScript twin any more: a direct move runs the kernel too (once for each mounting
// surface), and the owned session that replaces it from the third move on runs it once per move.
export const DIRECT_MOVE_KERNEL_CALLS=2;
export function expectedRouting(input,moves){
  const directMoves=input.count>=SHELF_PREVIEW_MIN_OBJECTS?Math.min(moves,SHELF_PREVIEW_DIRECT_MOVES):moves,sessionMoves=moves-directMoves;
  return{directMoves,sessionMoves,expectedCalls:directMoves*DIRECT_MOVE_KERNEL_CALLS+sessionMoves};
}
export async function benchmarkShelfPlacementSession(core,input){
  const {fixture,targets}=shelfSessionFixture(input),proof=[],before={...window.placementStats};
  const session=createShelfPlacementPreview(fixture.objects,fixture.options);
  if(!session)throw new Error('Unexpected session preparation rejection');
  if(window.placementStats.allocations!==before.allocations)throw new Error('Preparation retained a WASM allocation');
  try{
    for(const target of targets){
      const expected=moveShelfDecoration(fixture.objects,fixture.movedKey,target,fixture.options);
      const actual=session.move(core,fixture.movedKey,target.shelf,target.x);
      same(actual,expected);proof.push({target,sha256:await hash(canonicalPlacement(expected))});
      for(const row of actual.shelves)if(row.items!==row.objects)throw new Error('Row array identity changed');
      for(const item of actual.objects)if(!fixture.objects.some(object=>object.key===item.key&&object.metadata===item.metadata))throw new Error('Metadata identity changed');
    }
  }finally{session.dispose();}
  const actualCalls=window.placementStats.calls-before.calls;
  const {directMoves,sessionMoves,expectedCalls}=expectedRouting(input,targets.length);
  if(actualCalls!==expectedCalls)throw new Error('Actual kernel calls disagree with the shared preview policy');
  if(window.placementStats.live!==0||window.placementStats.allocations!==window.placementStats.releases)throw new Error('Session arena leaked');
  const repetitions=input.moves===1&&input.count<=40?16:input.moves<=8&&input.count<=200?2:1;
  const rounds=9,warmups=2,samples={javascript:[],rust:[]},orders=[];
  const run=rust=>{
    let checksum=0;
    for(let n=0;n<repetitions;n++){
      const drag=rust?createShelfPlacementPreview(fixture.objects,fixture.options):null;
      if(rust&&!drag)throw new Error('Timed session rejected');
      try{
        for(const target of targets){
          const result=rust?drag.move(core,fixture.movedKey,target.shelf,target.x)
            :moveShelfDecoration(fixture.objects,fixture.movedKey,target,fixture.options);
          checksum+=placementChecksum(result);
        }
      }finally{drag?.dispose();}
    }
    return checksum;
  };
  const checksum=run(false);same(run(true),checksum);
  for(let index=0;index<warmups;index++){same(run(false),checksum);same(run(true),checksum);}await pause();
  for(let round=0;round<rounds;round++){
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const begin=performance.now();const actual=run(kind==='rust');samples[kind].push(performance.now()-begin);same(actual,checksum);await pause();}
  }
  return{input,proof,actualCalls,inputSha256:await hash(canonicalPlacement(fixture)),
    methodology:{rounds,warmups,repetitions,movesPerDrag:targets.length,preparationIncluded:true,disposalIncluded:true,publicApisUnchanged:true,
      policy:{minimumObjects:SHELF_PREVIEW_MIN_OBJECTS,initialJavaScriptMoves:SHELF_PREVIEW_DIRECT_MOVES}},
    proofRouting:{rustCalls:actualCalls,directMoves,sessionMoves,contextPrepared:sessionMoves>0},
    samples,orders,javascriptPerDragMedianMs:median(samples.javascript)/repetitions,rustPerDragMedianMs:median(samples.rust)/repetitions,
    javascriptPerMoveAmortizedMs:median(samples.javascript)/(repetitions*targets.length),
    rustPerMoveAmortizedMs:median(samples.rust)/(repetitions*targets.length),
    memory:{...window.placementStats,preparedGeometryBytes:sessionMoves?fixture.objects.length*7*8:0,wasmCapacityBytes:core.memory.buffer.byteLength}};
}
