// Keep one 128 KiB scratch chunk instead of another complete atlas copy.
export function rustStudioHalfScan(core,data){
 if(typeof core?.studio_half_scan!=='function'||!(data instanceof Uint16Array)
  ||Object.getPrototypeOf(data)!==Uint16Array.prototype||data.length<65_536||Object.prototype.toString.call(data.buffer)==='[object SharedArrayBuffer]')return null
 const count=65_536,arena=count/4;let pointer
 try{pointer=core.alloc_f64(arena)}catch{return null}
 if(!pointer)return null
 try{
  let lit=false
  for(let offset=0;offset<data.length;offset+=count){
   const end=Math.min(offset+count,data.length),chunk=new Uint16Array(core.memory.buffer,pointer,end-offset)
   chunk.set(data.subarray(offset,end))
   const result=core.studio_half_scan(pointer,chunk.length)
   if(result===0)return false
   if(result!==1&&result!==2)return null
   if(result===2)lit=true
  }
  return lit
 }catch{return null}finally{core.free_f64(pointer,arena)}
}
export function legacyStudioHalfScan(data){
 let lit=false
 for(let index=0;index<data.length;index++){
  const value=data[index]
  if((value&0x7c00)===0x7c00)return false
  if(value!==0)lit=true
 }
 return lit
}
