import {getRustCore} from './rust-core.js';

/** Numeric format classification; undefined retains the original detector. */
export function rustBookFormat(bytes) {
  const core=getRustCore();
  if(!(bytes instanceof Uint8Array) || typeof core?.sniff_book_format!=='function'
    || !core.memory || typeof core.alloc_f64!=='function' || typeof core.free_f64!=='function')return undefined;
  const size=Math.min(200,bytes.length);
  if(!size)return 0;
  const length=Math.ceil(size/8);let pointer=0;
  try {
    pointer=core.alloc_f64(length);if(!pointer)return undefined;
    new Uint8Array(core.memory.buffer,pointer,size).set(bytes.subarray(0,size));
    const code=core.sniff_book_format(pointer,size);
    return Number.isInteger(code)&&code>=0&&code<=4?code:undefined;
  } catch {return undefined;}
  finally {if(pointer)core.free_f64(pointer,length);}
}
