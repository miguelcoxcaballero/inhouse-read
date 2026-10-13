// Actual VITS frame durations, unchanged addition order and original UTF-16
// boundary identities. The retained arena is bounded and never overlaps calls.
const MAX_ELEMENTS=8192
let arena=null
export function releaseDurationArena(){if(arena){arena.core.free_f64(arena.pointer,arena.length);arena=null}}
export function rustDurationMarks(core,marks,durations,cfg){
 if(typeof core?.duration_marks!=='function'||typeof core.alloc_f64!=='function'||typeof core.free_f64!=='function'||!core.memory||arena?.inUse)return undefined
 const count=durations?.length,length=marks?.length
 if(!(durations instanceof Float32Array||durations instanceof Float64Array||Array.isArray(durations))||!Array.isArray(marks)||!Number.isInteger(count)||count<32||count>32768||length>4096||cfg.count!==count||!Number.isInteger(cfg.base)||![cfg.samples,cfg.trim,cfg.lead,cfg.length].every(Number.isFinite))return undefined
 if(!length)return undefined
 const indices=new Float64Array(length)
 for(let i=0;i<length;i++){const descriptor=marks[i]&&Object.getOwnPropertyDescriptor(marks[i],'phoneme'),offset=marks[i]&&Object.getOwnPropertyDescriptor(marks[i],'offset');if(!descriptor||!Object.hasOwn(descriptor,'value')||!Number.isInteger(descriptor.value)||!offset||!Object.hasOwn(offset,'value'))return undefined;indices[i]=descriptor.value}
 // Arrays with coercible values or holes retain the original every/reduce.
 if(Object.hasOwn(durations,'every')||Object.hasOwn(durations,'reduce')||Object.hasOwn(durations,'slice'))return undefined
 if(Array.isArray(durations))for(let i=0;i<count;i++){const descriptor=Object.getOwnPropertyDescriptor(durations,String(i));if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='number')return undefined}
 const required=count+length*3+6,keep=required<=MAX_ELEMENTS
 let current,failed=false
 try{
  if(arena?.core!==core||arena.length<required||!keep)releaseDurationArena()
  if(arena)current=arena
  else{let capacity=32;while(capacity<required)capacity*=2;const pointer=core.alloc_f64(capacity);if(!pointer)return undefined;current={core,pointer,length:capacity,inUse:false};if(keep)arena=current}
  current.inUse=true
  const packet=new Float64Array(core.memory.buffer,current.pointer,required);packet.set(durations);packet.set(indices,count);packet.set([cfg.base,count,cfg.samples,cfg.trim,cfg.lead,cfg.length],count+length)
  const outputPointer=current.pointer+(count+length+6)*8
  const result=core.duration_marks(current.pointer,count,current.pointer+count*8,length,current.pointer+(count+length)*8,outputPointer)
  if(!Number.isInteger(result)||result<0||result>length){failed=true;return undefined}
  const output=new Float64Array(core.memory.buffer,outputPointer,result*2),values=[]
  for(let i=0;i<result;i++){const index=output[i*2],sample=output[i*2+1];if(!Number.isInteger(index)||index<0||index>=length||!Number.isFinite(sample)){failed=true;return undefined}values.push({offset:marks[index].offset,sample})}
  return values
 }catch{failed=true;return undefined}
 finally{if(current){current.inUse=false;if(current!==arena||failed){if(current===arena)arena=null;core.free_f64(current.pointer,current.length)}}}
}
