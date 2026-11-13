// The Supertonic numeric plans (rust-ui/src/voice_kernels.rs over rust-core/src/supertonic_runtime.rs). The worker already
// awaited the voice module; what stays here is the browser's: the injectable random source and Math.log/Math.cos.
import {loadedRustVoiceUI as voice} from '../../rust-voice-ui.js';
export function supertonicNoise(length,random){
 const kernels=voice(),pairs=new Float64Array(length*2);
 // RNG is injectable browser state; preserve its two draws per sample, in order.
 for(let i=0;i<pairs.length;i++)pairs[i]=+random();
 kernels.voice_host_noise_plan(pairs);
 for(let i=0;i<pairs.length;i+=2){pairs[i]=Math.log(pairs[i]);pairs[i+1]=Math.cos(pairs[i+1]);}
 return kernels.voice_host_noise_finish(pairs);
}
