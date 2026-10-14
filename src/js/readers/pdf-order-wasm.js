import {getRustCore} from '../rust-core.js';
import {coreRequired} from './core-required.js';
const decoder=new TextDecoder(),STRIDE=7,MAX_LINES=32768,PATH_BYTES=80;
const counter=text=>/^\s*(?:\d{1,5}|[ivxlcdm]{1,7})\s*$/i.test(text);
/** The kernel returns a permutation and ASCII column paths. All text,
 * metadata and entry references stay owned by the PDF reader. */
export function rustPDFOrderLines(lines,rtl){
 if(!lines.length)return[];
 const core=getRustCore(),count=lines.length;
 if(typeof core?.pdf_order_lines!=='function'||count>MAX_LINES||typeof rtl!=='boolean')return undefined;
 const recordsOffset=count*STRIDE*8,pathsOffset=Math.ceil((recordsOffset+count*3*4)/8)*8;
 const capacity=count*PATH_BYTES,length=Math.ceil((pathsOffset+capacity)/8);let pointer;
 try{pointer=core.alloc_f64(length);}catch{return undefined;}if(!pointer)return undefined;
 try{
  const input=new Float64Array(core.memory.buffer,pointer,count*STRIDE);
  for(let i=0;i<count;i++){
   const {x0,x1,top,bottom,y,height,text}=lines[i];
   if(!Number.isFinite(x0)||!Number.isFinite(x1)||!Number.isFinite(top)||!Number.isFinite(bottom)
     ||!Number.isFinite(y)||!Number.isFinite(height)||x0>x1||top>bottom||height<=0)return undefined;
   const at=i*STRIDE;input[at]=x0;input[at+1]=x1;input[at+2]=top;input[at+3]=bottom;input[at+4]=y;input[at+5]=height;input[at+6]=Number(counter(text));
  }
  if(core.pdf_order_lines(pointer,count,Number(rtl),pointer+recordsOffset,pointer+pathsOffset,capacity)!==count)return undefined;
  const records=new Uint32Array(core.memory.buffer,pointer+recordsOffset,count*3),seen=new Uint8Array(count);let end=0;
  for(let i=0;i<count;i++){
   const id=records[i*3],offset=records[i*3+1],size=records[i*3+2];
   if(id>=count||seen[id]||offset!==end||size>PATH_BYTES||offset+size>capacity)return undefined;
   seen[id]=1;end=offset+size;
  }
  const paths=decoder.decode(new Uint8Array(core.memory.buffer,pointer+pathsOffset,end));
  if(paths.length!==end||/[^/a-z0-9-]/.test(paths))return undefined;
  return Array.from({length:count},(_,i)=>({...lines[records[i*3]],column:paths.slice(records[i*3+1],records[i*3+1]+records[i*3+2])}));
 }catch{return undefined;}finally{core.free_f64(pointer,length);}
}

/** The lines of a page in reading order, each with its column path. */
export const pdfOrderLines=(lines,rtl)=>coreRequired(rustPDFOrderLines(lines,rtl));
