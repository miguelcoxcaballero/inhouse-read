import {getRustCore} from '../rust-core.js';

/** Return fresh host-owned bounds. undefined asks for the original algorithm;
 * an empty array is a valid page without visible image regions. */
export function rustPDFImageRects(coordinates,width,height) {
  const count=Math.floor(coordinates.length/6),core=getRustCore();
  if(typeof core?.pdf_image_rects!=='function'||count>32768
    ||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return undefined;
  if(!count)return [];
  const length=count*10;let pointer;
  try{pointer=core.alloc_f64(length);}catch{return undefined;}
  if(!pointer)return undefined;
  try{
    const input=new Float64Array(core.memory.buffer,pointer,count*6);
    // Number.isFinite in the original rejects strings rather than coercing.
    for(let i=0;i<input.length;i++)input[i]=typeof coordinates[i]==='number'?coordinates[i]:NaN;
    const size=core.pdf_image_rects(pointer,count,width,height,pointer+count*6*8);
    if(!Number.isInteger(size)||size<0||size>count)return undefined;
    const output=new Float64Array(core.memory.buffer,pointer+count*6*8,size*4),rects=[];
    for(let i=0;i<size;i++){
      const at=i*4,x0=output[at],y0=output[at+1],x1=output[at+2],y1=output[at+3];
      if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(x1)||!Number.isFinite(y1)
        ||x0<0||y0<0||x1>width||y1>height||x1<=x0||y1<=y0)return undefined;
      rects.push({x0,y0,x1,y1});
    }
    return rects;
  }catch{return undefined;}finally{core.free_f64(pointer,length);}
}
