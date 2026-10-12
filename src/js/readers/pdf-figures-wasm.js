import {getRustCore} from '../rust-core.js';

export function rustPDFPlaceFigures(rects,layout,source,viewport) {
  const core=getRustCore(),lines=layout?.lines,count=lines?.length,images=rects.length;
  if(typeof core?.pdf_place_figures!=='function'||!layout?.geometric||!count||count>32768||images>32768)return undefined;
  if(!images)return [];
  let dominant;
  try {
    for(const line of lines)for(const entry of line.entries){
      if(typeof entry.item.str!=='string')return undefined;
      if(!dominant||entry.item.str.length>dominant.item.str.length)dominant=entry;
    }
    if(!dominant)return undefined;
    const transform=viewport.transform||[1,0,0,-1,0,viewport.height],t=dominant.item.transform;
    const angle=Math.atan2(transform[1]*t[0]+transform[3]*t[1],transform[0]*t[0]+transform[2]*t[1]);
    const params=[Math.cos(angle),Math.sin(angle),viewport.width/source.width,viewport.height/source.height,layout.text.length];
    if(!params.every(Number.isFinite)||params[2]<=0||params[3]<=0)return undefined;
    const columns=new Map(),rectOffset=count*6,paramOffset=rectOffset+images*4,outOffset=paramOffset+5,length=outOffset+images*2;
    let pointer;try{pointer=core.alloc_f64(length);}catch{return undefined;}if(!pointer)return undefined;
    try {
      const data=new Float64Array(core.memory.buffer,pointer,length);
      for(let i=0;i<count;i++){
        const line=lines[i],key=line.column;if(!columns.has(key))columns.set(key,columns.size);
        const values=[line.x0,line.x1,line.y,line.height,line.start,columns.get(key)];
        if(!values.every(Number.isFinite))return undefined;
        data.set(values,i*6);
      }
      for(let i=0;i<images;i++){
        const rect=rects[i],values=[rect.x0,rect.y0,rect.x1,rect.y1];if(!values.every(Number.isFinite))return undefined;
        data.set(values,rectOffset+i*4);
      }
      data.set(params,paramOffset);
      if(core.pdf_place_figures(pointer,count,columns.size,pointer+rectOffset*8,images,pointer+paramOffset*8,pointer+outOffset*8)!==1)return undefined;
      const values=new Float64Array(core.memory.buffer,pointer+outOffset*8,images*2),seen=new Uint8Array(images),figures=[];
      for(let i=0;i<images;i++){
        const id=values[i*2],offset=values[i*2+1];
        if(!Number.isInteger(id)||id<0||id>=images||seen[id]||!Number.isSafeInteger(offset)||offset<0||offset>layout.text.length)return undefined;
        seen[id]=1;figures.push({rect:rects[id],offset});
      }
      return figures;
    }catch{return undefined;}finally{core.free_f64(pointer,length);}
  }catch{return undefined;}
}
