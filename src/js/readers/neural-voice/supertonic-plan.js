// The Supertonic numeric plans (rust-ui/src/voice_kernels.rs over rust-core/src/supertonic_runtime.rs). The worker already
// awaited the voice module; what stays here is the browser's: the injectable random source and Math.log/Math.cos.
import {loadedRustVoiceUI as voice} from '../../rust-voice-ui.js';
export const supertonicRuntimeConfig=(config,steps)=>voice().voice_host_supertonic_config(config,steps);
export const supertonicTextIds=(text,indexer)=>voice().voice_host_supertonic_ids(text,indexer);
export const supertonicLocalMarks=(marks,start,end)=>voice().voice_host_supertonic_local_marks(marks,start,end);
export function supertonicNoise(length,random){
 const kernels=voice(),block=256,output=new Float32Array(length);
 for(let start=0;start<length;start+=block){
  // RNG is injectable browser state; preserve its two draws per sample.
  const pairs=new Float64Array(Math.min(block,length-start)*2);
  for(let i=0;i<pairs.length;i++)pairs[i]=+random();
  kernels.voice_host_noise_plan(pairs);
  for(let i=0;i<pairs.length;i+=2){pairs[i]=Math.log(pairs[i]);pairs[i+1]=Math.cos(pairs[i+1]);}
  output.set(kernels.voice_host_noise_finish(pairs),start);
 }
 return output;
}
export const createSupertonicPcmJoin=sampleRate=>voice().voice_host_pcm_join(sampleRate);
export const supertonicStyleValid=(dims,data)=>Array.isArray(dims)&&Array.isArray(data)&&voice().voice_host_style_valid(dims,Float64Array.from(data,value=>typeof value==='number'?value:NaN));
export const createSupertonicState=()=>voice().voice_host_runtime_state();
