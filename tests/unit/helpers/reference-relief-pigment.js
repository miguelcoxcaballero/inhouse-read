// Frozen pre-migration pigment loops; distance already used Rust in 1.7.169.
import {wasmInsideDistance} from './reference-relief-bridge.js';
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const toByte=value=>Math.round(clamp(value,0,1)*255);
export function* referencePigment(core,membership,width,height,previous=null,clonePrevious=true){
 const count=width*height,bevel=Math.max(1.2,Math.max(width,height)*.003);
 const hard=new Uint8Array(count);
 for(let i=0;i<count;i++){hard[i]=membership[i]>0?1:0;if((i&4095)===4095)yield;}
 const distance=yield*wasmInsideDistance(core,hard,width,height);
 if(previous){
  const owners=clonePrevious?previous.owners.slice():previous.owners,baseMask=clonePrevious?previous.baseMask.slice():previous.baseMask,baseHeight=clonePrevious?previous.baseHeight.slice():previous.baseHeight;
  for(let i=0;i<count;i++){
   const amount=toByte(membership[i]);
   if(amount>baseMask[i]){owners[i]=previous.owner;baseMask[i]=amount;baseHeight[i]=membership[i]*smoothstep(0,bevel,distance[i]-.5)*previous.heightMM/.6*255;}
   if((i&1023)===1023)yield;
  }
  return {owners,baseMask,baseHeight};
 }
 const mask=new Uint8Array(count),gloss=new Uint8Array(count),heightMap=new Uint8Array(count);
 for(let i=0;i<count;i++){
  const soft=membership[i]*(hard[i]?smoothstep(0,bevel,distance[i]-.5):0);
  mask[i]=gloss[i]=toByte(membership[i]);heightMap[i]=toByte(soft*.3/.6);
  if((i&1023)===1023)yield;
 }
 return {mask,gloss,heightMap};
}
