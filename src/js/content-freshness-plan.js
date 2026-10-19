import {withArena,putText} from './readers/neural-voice/core-call.js';
// The app core has already been awaited by content-freshness's shell parser.
// No fetch or initialization is introduced by this host adapter.
export function createContentFreshnessPlan(core,started){
 const textCall=(text,fn)=>withArena(core,Math.max(1,Math.ceil(text.length/4)),pointer=>{putText(core,pointer,text);return fn(pointer,text.length);});
 let handle=textCall(started,(pointer,length)=>core.freshness_new(pointer,length));
 if(!handle)throw Error('No se pudo comprobar el contenido');
 return{
  begin:()=>!!core.freshness_begin(handle),
  finish:()=>core.freshness_finish(handle),
  newer:latest=>!!textCall(latest,(pointer,length)=>core.freshness_newer(handle,pointer,length)),
  retry:(same,now,last)=>!!core.freshness_retry(same?1:0,now,last),
  interval:()=>core.freshness_interval(),
  safe:reader=>!!core.freshness_safe(reader?1:0,reader?.hidden===false?1:0),
  launch(){let state=core.freshness_launch_new();if(!state)throw Error('No se pudo comprobar el contenido');return{
   touch:()=>core.freshness_launch_touch(state),
   untouched:()=>!!core.freshness_launch_untouched(state),
   reloading:started=>!!core.freshness_launch_reload(state,started?1:0),
   dispose(){if(state){core.freshness_launch_free(state);state=0;}}
  };},
  dispose(){if(handle){core.freshness_free(handle);handle=0;}}
 };
}
