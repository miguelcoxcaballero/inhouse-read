import {getRustCore} from './rust-core.js';
function finish(geometries,kind){
 const core=getRustCore();if(typeof core?.mesh_finish!=='function'||![0,1].includes(kind)||!Array.isArray(geometries)||!geometries.length||geometries.length>1024||(kind===1&&geometries.length!==1))return false;
 const attributes=[];let count=0;
 for(const geometry of geometries){
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),out=geometry.getAttribute(kind===0?'uv':'normal'),size=p?.count;
  if(!Number.isInteger(size)||size<1||p.itemSize!==3||n?.count!==size||n.itemSize!==3||out?.count!==size||out.itemSize!==(kind===0?2:3))return false;
  if(![p,n,out].every(a=>a.array instanceof Float32Array&&a.array.buffer!==core.memory.buffer))return false;
  count+=size;if(count>200000)return false;attributes.push({p,n,out,size});
 }
 const channels=kind===0?2:3,outputSize=count*channels,length=Math.ceil((count*6+outputSize)/2);let pointer;
 try{
  pointer=core.alloc_f64(length);if(!pointer)return false;
  const input=new Float32Array(core.memory.buffer,pointer,count*6);let offset=0;
  for(const {p,n,size} of attributes){input.set(p.array,offset*3);input.set(n.array,count*3+offset*3);offset+=size;}
  const output=pointer+count*24;if(core.mesh_finish(pointer,pointer+count*12,count,kind,output)!==count)return false;
  const result=new Float32Array(core.memory.buffer,output,outputSize);offset=0;
  for(const {out,size} of attributes){out.array.set(result.subarray(offset*channels,(offset+size)*channels));offset+=size;}
  return true;
 }catch{return false;}finally{if(pointer)core.free_f64(pointer,length);}
}
export const rustFinishMesh=(geometry,kind)=>finish([geometry],kind);
// Paint has no relationship between vertices: transfer every assembly piece
// together rather than paying for one WASM round trip per tiny rail or tab.
export const rustPaintMeshes=geometries=>finish(geometries,0);
