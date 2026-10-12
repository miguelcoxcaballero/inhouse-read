import {getRustCore} from './rust-core.js';
export const MOTION_KEYS = Object.freeze(['x','y','scale','angle','pitch','roll','coverOpen','bookmarkWithdraw','pageTheme']);

/** A motion owns one small allocation until it ends or is cancelled. No WASM
 * view survives a call: another kernel may grow memory between frames. */
export function createRustBookMotion(frames) {
  const core=getRustCore(),count=frames.length;
  if(typeof core?.book_motion_prepare!=='function'||typeof core?.book_motion_sample!=='function'
    ||count<2||count>1024)return null;
  const tableOffset=count*10,resultOffset=tableOffset+count*19,length=resultOffset+9;
  let pointer=0;
  const dispose=()=>{if(pointer){core.free_f64(pointer,length);pointer=0;}};
  try {
    pointer=core.alloc_f64(length);if(!pointer)return null;
    const source=new Float64Array(core.memory.buffer,pointer,count*10);
    const themed=frames.every(frame=>frame.transform.pageTheme!=null);
    for(let i=0;i<count;i++) {
      const time=frames[i].offset??i/(count-1);
      if(!Number.isFinite(time)){dispose();return null;}
      source[i*10]=time;
      for(let key=0;key<9;key++) {
        const value=key===8&&!themed?0:frames[i].transform[MOTION_KEYS[key]]??0;
        if(!Number.isFinite(value)){dispose();return null;}
        source[i*10+key+1]=value;
      }
    }
    if(core.book_motion_prepare(pointer,count,pointer+tableOffset*8)!==1){dispose();return null;}
    return {
      sample(progress) {
        if(!pointer||!Number.isFinite(progress))return undefined;
        try {
          if(core.book_motion_sample(pointer+tableOffset*8,count,progress,pointer+resultOffset*8)!==1)return undefined;
          const values=new Float64Array(core.memory.buffer,pointer+resultOffset*8,9),pose={};
          for(let key=0;key<(themed?9:8);key++)pose[MOTION_KEYS[key]]=values[key];
          return pose;
        }catch{return undefined;}
      },dispose
    };
  }catch{dispose();return null;}
}
