import {getRustCore} from '../rust-core.js';
import {coreRequired} from './core-required.js';

// The most picture footprints the kernel clips in one call; a page with more is answered in parts.
const MAX_PATHS=32768;

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
