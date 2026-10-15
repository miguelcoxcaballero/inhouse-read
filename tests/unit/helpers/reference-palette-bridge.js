// Own one palette job per analysis; finally also frees it on cancellation.
// The caller supplies the original, pure rgbToOklab function.
const LIMIT = 512 * 512, PIXELS = 1024, BINS = 256, NEIGHBORS = 32, SUPPORT = 512;
const NAMES = ['new','free','count','pixels','bins','labs','cells','neighbors','sort','next','support','accept','finish'];
const aligned = bytes => Math.ceil(bytes / 8) * 8;

export function* rustReliefPalette(core, image, rgbToOklab, withSeed = false) {
  const {width,height,data}=image || {};
  if (!core?.memory || typeof core.alloc_f64!=='function' || typeof core.free_f64!=='function'
    || NAMES.some(name=>typeof core[`relief_palette_${name}`]!=='function')
    || typeof rgbToOklab!=='function' || !Number.isInteger(width) || !Number.isInteger(height)
    || width<1 || height<1 || width*height>LIMIT
    || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    || data.length!==width*height*4 || data.buffer===core.memory.buffer) return null;
  const pixels=width*height, binsOffset=aligned(data.length), labsOffset=binsOffset+BINS*7*8;
  const chosenOffset=labsOffset+BINS*3*8, length=(chosenOffset+10*2*8)/8;
  let job=0,pointer=0;
  const ok=value=>{if(value!==1)throw new Error('Rejected relief palette stage');};
  try {
    job=core.relief_palette_new(pixels); if(!job)return null;
    pointer=core.alloc_f64(length); if(!pointer)return null;
    new Uint8Array(core.memory.buffer,pointer,data.length).set(data);
    for(let from=0;from<pixels;from+=PIXELS){
      ok(core.relief_palette_pixels(job,pointer,from,Math.min(pixels,from+PIXELS)));
      if(from+PIXELS<=pixels)yield;
    }
    const count=core.relief_palette_count(job,0),opaque=core.relief_palette_count(job,1),bins=[];
    if(!Number.isInteger(count)||count<0||count>32768||!Number.isInteger(opaque)||opaque<0||opaque>pixels)return null;
    for(let from=0;from<count;from+=BINS){
      const end=Math.min(count,from+BINS),size=end-from;
      ok(core.relief_palette_bins(job,from,end,pointer+binsOffset));
      // Copy metadata before any callback that could synchronously grow WASM.
      const fields=Array.from(new Float64Array(core.memory.buffer,pointer+binsOffset,size*7));
      const labs=new Float64Array(size*3);
      for(let i=0;i<size;i++){
        const at=i*7,rgb=fields.slice(at+2,at+5),lab=rgbToOklab(...rgb);
        if(!Array.isArray(lab)||lab.length!==3||!lab.every(Number.isFinite))return null;
        bins.push({count:fields[at],modeCount:fields[at+1],rgb,packed:fields[at+5],representativeDistance:fields[at+6],lab});
        labs.set(lab,i*3);
      }
      new Float64Array(core.memory.buffer,pointer+labsOffset,size*3).set(labs);
      ok(core.relief_palette_labs(job,from,end,pointer+labsOffset));
      if(from+BINS<=count)yield;
    }
    for(let from=0;from<count;from+=BINS){
      ok(core.relief_palette_cells(job,from,Math.min(count,from+BINS)));
      if(from+BINS<=count)yield;
    }
    const cells=core.relief_palette_count(job,2);
    if(!Number.isInteger(cells)||cells<0||cells>count)return null;
    for(let from=0;from<cells;from+=NEIGHBORS){
      ok(core.relief_palette_neighbors(job,from,Math.min(cells,from+NEIGHBORS)));
      if(from+NEIGHBORS<=cells)yield;
    }
    ok(core.relief_palette_sort(job)); yield;
    for(;;){
      const next=core.relief_palette_next(job); if(next===0)break; ok(next);
      for(let from=0;from<count;from+=SUPPORT){
        ok(core.relief_palette_support(job,from,Math.min(count,from+SUPPORT)));
        if(from+SUPPORT<=count)yield;
      }
      ok(core.relief_palette_accept(job)); yield;
    }
    const chosen=core.relief_palette_finish(job,pointer+chosenOffset);
    if(!Number.isInteger(chosen)||chosen<0||chosen>10)return null;
    const pairs=new Float64Array(core.memory.buffer,pointer+chosenOffset,chosen*2),colors=[];
    for(let i=0;i<chosen;i++){
      const index=pairs[i*2],supported=pairs[i*2+1];
      if(!Number.isInteger(index)||index<0||index>=count||!Number.isInteger(supported)||supported<1||supported>opaque)return null;
      colors.push({...bins[index],supported});
    }
    const result={bins,opaque,colors};
    // Private decoded rasters are immutable throughout analysis. Reuse their
    // existing RGBA arena; generic callers retain the original result shape.
    if(withSeed && typeof core.relief_cover_seed==='function') {
      try {
        const seed=core.relief_cover_seed(pointer,width,height);
        if(Number.isInteger(seed) && seed>=0 && seed<=0xffffffff) result.seed=seed;
      } catch { /* The completed palette stays useful; the caller hashes in JS. */ }
    }
    return result;
  } catch { return null; }
  finally {
    try { if(pointer)core.free_f64(pointer,length); }
    finally { if(job)core.relief_palette_free(job); }
  }
}
