import {getRustDecorCore} from './rust-decor-core.js';
export function rustLampSurface(kind,width,height){
 const core=getRustDecorCore(),type={wood:0,linen:1,black:2}[kind];
 if(typeof core?.lamp_surface_rows!=='function'||type===undefined||!Number.isInteger(width)||!Number.isInteger(height)
  ||width<1||height<1||width>2048||height>2048)return undefined;
 const rows=Math.min(16,height),length=width*rows;let pointer;
 try{
  pointer=core.alloc_f64(length);if(!pointer)return undefined;
  const pigment=new Uint8Array(width*height*4),data=new Uint8Array(pigment.length);
  for(let row=0;row<height;row+=rows){
   const count=Math.min(rows,height-row),size=width*count*4;
   if(core.lamp_surface_rows(width,height,row,count,type,pointer)!==1)return undefined;
   pigment.set(new Uint8Array(core.memory.buffer,pointer,size),row*width*4);
   data.set(new Uint8Array(core.memory.buffer,pointer+size,size),row*width*4);
  }
  return{width,height,pigment,data};
 }catch{return undefined;}finally{if(pointer)core.free_f64(pointer,length);}
}
