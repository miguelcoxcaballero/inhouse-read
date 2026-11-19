// Frozen copy of src/js/book-motion-wasm.js and src/js/book-motion.js as they were before the shelf module sampled a
// book's motion itself (rust-ui/src/book_sampler.rs): the bridge that marshalled keyframes into the numeric core.
// The differential tests compare production with it.
import {getRustCore} from '../../../src/js/rust-core.js';
export const MOTION_KEYS = Object.freeze(['x','y','scale','angle','pitch','roll','coverOpen','bookmarkWithdraw','pageTheme']);

/** A motion owns one small allocation until it ends or is cancelled: its prepared
 * keyframes, one pose and its clock. No WASM view survives a call (another kernel may
 * grow memory between frames). The kernels are total, so any keyframes (duplicate or
 * reversed offsets, NaN, strings) give the numbers the original sampler gave; only a
 * count outside 2..1024 or a core that cannot allocate yields null. */
export function createRustBookMotion(frames) {
  const core=getRustCore(),count=frames?.length;
  if(typeof core?.book_motion_prepare!=='function'||typeof core?.book_motion_sample!=='function'
    ||typeof core?.book_motion_clock_start!=='function'||typeof core?.book_motion_clock_step!=='function'||!(count>=2&&count<=1024))return null;
  const tableOffset=count*10,resultOffset=tableOffset+count*19,clockOffset=resultOffset+9,length=clockOffset+4;
  let pointer=0,duration=0;
  const dispose=()=>{if(pointer){core.free_f64(pointer,length);pointer=0;}};
  try {
    pointer=core.alloc_f64(length);if(!pointer)return null;
    const source=new Float64Array(core.memory.buffer,pointer,count*10);
    const themed=frames.every(frame=>frame.transform.pageTheme!=null);
    for(let i=0;i<count;i++) {
      source[i*10]=Number(frames[i].offset??i/(count-1));
      for(let key=0;key<9;key++)source[i*10+key+1]=key===8&&!themed?0:Number(frames[i].transform[MOTION_KEYS[key]]??0);
    }
    if(core.book_motion_prepare(pointer,count,pointer+tableOffset*8)!==1){dispose();return null;}
    return {
      sample(progress) {
        if(!pointer)return undefined;
        if(core.book_motion_sample(pointer+tableOffset*8,count,progress,pointer+resultOffset*8)!==1)throw new Error('El módulo numérico no pudo muestrear el movimiento.');
        const values=new Float64Array(core.memory.buffer,pointer+resultOffset*8,9),pose={};
        for(let key=0;key<(themed?9:8);key++)pose[MOTION_KEYS[key]]=values[key];
        return pose;
      },
      /** Real time, so a slow device finishes each phase on schedule. */
      start(milliseconds,now){if(!pointer)return;duration=milliseconds;core.book_motion_clock_start(pointer+clockOffset*8,milliseconds,now);},
      step:now=>pointer?core.book_motion_clock_step(pointer+clockOffset*8,duration,now):1,
      dispose
    };
  }catch{dispose();return null;}
}

/** Monotone Hermite interpolation: continuous velocity, no unwanted overshoot when the
 * book slows down, changes direction or returns to its shelf. The numbers come from the
 * numeric core (rust-core/src/book_motion.rs); the original JavaScript sampler, frozen
 * in tests/unit/helpers/reference-book-motion.js, is what the tests compare it with.
 * Scheduling, poses and interruption stay in the renderer. */
export function createBookMotionSampler(frames) {
  const native = createRustBookMotion(frames);
  if (!native) throw new RangeError('El movimiento del libro necesita entre 2 y 1024 fotogramas y el módulo numérico cargado.');
  return native;
}

export function sampleBookMotion(frames, progress) {
  const sampler = createBookMotionSampler(frames);
  try { return sampler.sample(progress); } finally { sampler.dispose(); }
}
