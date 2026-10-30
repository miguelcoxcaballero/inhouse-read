import {getRustCore} from '../../../src/js/rust-core.js';
import {coreRequired} from '../../../src/js/readers/core-required.js';

// Pages assembled from tiles can draw many thousands of pictures; the kernel
// accepts a million before the host has to refuse.
const MAX_IMAGES=1_000_000,MAX_PATHS=32768;

/** Return fresh host-owned bounds. undefined means the kernel cannot answer
 * (a missing core, a refused page size); an empty array is a valid page without visible image regions. */
export function rustPDFImageRects(coordinates,width,height) {
  const count=Math.floor(coordinates.length/6),core=getRustCore();
  if(typeof core?.pdf_image_rects!=='function'||count>MAX_IMAGES
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


/** Ordered image clipping paths; an empty typed array is a valid result. */
export function rustPDFImagePaths(coordinates, width, height) {
  const count = Math.floor(coordinates.length / 6), core = getRustCore();
  if (typeof core?.pdf_image_paths !== 'function' || count > MAX_PATHS
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  if (!count) return new Float64Array();
  const length = count * 14, outputOffset = count * 6 * 8;
  let pointer = 0;
  try {
    pointer = core.alloc_f64(length);
    if (!pointer) return undefined;
    const input = new Float64Array(core.memory.buffer, pointer, count * 6);
    if (coordinates instanceof Float32Array || coordinates instanceof Float64Array) input.set(coordinates.subarray(0, count * 6));
    else for (let i = 0; i < input.length; i++) input[i] = typeof coordinates[i] === 'number' ? coordinates[i] : NaN;
    const size = core.pdf_image_paths(pointer, count, width, height, pointer + outputOffset);
    if (!Number.isInteger(size) || size < 0 || size > count) return undefined;
    return new Float64Array(core.memory.buffer, pointer + outputOffset, size * 8).slice();
  } catch { return undefined; }
  finally { if (pointer) core.free_f64(pointer, length); }
}

/** Composite illustration bounds of a page. An unusable page size has no visible regions. */
export function pdfImageRects(coordinates,width,height) {
  if(!(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0))return [];
  return coreRequired(rustPDFImageRects(coordinates,width,height));
}

/** Clipping paths of every picture footprint, whatever their number. A canvas without pixels has no path to clip. */
export function pdfImagePaths(coordinates,width,height) {
  if(!(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0))return new Float64Array();
  const count=Math.floor(coordinates.length/6);
  if(count<=MAX_PATHS)return coreRequired(rustPDFImagePaths(coordinates,width,height));
  const parts=[];
  for(let at=0;at<count*6;at+=MAX_PATHS*6)parts.push(coreRequired(rustPDFImagePaths(coordinates.slice(at,at+MAX_PATHS*6),width,height)));
  const joined=new Float64Array(parts.reduce((sum,part)=>sum+part.length,0));
  let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}
  return joined;
}
