// Frozen queue and sharing policy from main 423ce4ba; Three/browser calls are
// supplied by the test so native and original policies see the same host.
export function referencePlantSurfaceQueue(host) {
  const surfaces=new Map(),queue=[],settled=[],redraws=new Set();
  const idle=() => host.schedule(),deferPlantPaint=host.defer;
  const SURFACE_ERROR='Las texturas de la planta no se pudieron calcular. Recarga la página.';
  const THREE={SRGBColorSpace:true,NoColorSpace:false};
  const savedSurface=host.savedSurface,dataTexture=host.texture,getRustDecorCore=()=>null;
  const rustPlantLattice=(_core,...args)=>host.lattice(...args);
  function paintRows(job,end) {
    const family=job.spec.family,index=family===0?0:family===1?1:family===2?2:3;
    if (!host.painters[index](job,end-job.row)) throw new Error(SURFACE_ERROR);
  }
function pump(deadline) {
  if (deferPlantPaint()) { idle(pump); return; }
  // Use the idle period the browser offers (a forced, timed-out slice stays
  // short). Bounded by rows as well, so a frozen clock cannot stall the loop.
  const until = performance.now() + Math.min(16, Math.max(5, deadline.timeRemaining() - 1));
  for (let chunk = 0; queue.length && chunk < 48 && (chunk === 0 || performance.now() < until); chunk++) {
    const job = queue[0];
    const end = Math.min(job.height, job.row + 4);
    try { paintRows(job, end); job.row = end; }
    catch (error) {
      // The coarse first look stays on the plants that already use it and they are released, but the surface is
      // not final: it is forgotten below, so it is never saved as a finished painting and the next plant of
      // this kind paints it again.
      host.warn(error);
      job.row = job.height; job.failed = true;
    }
    if (job.row < job.height) continue;
    queue.shift();
    const { base } = job;
    if (job.failed && surfaces.get(job.key) === base) surfaces.delete(job.key);
    // One new Source version re-uploads the shared image once; every live
    // clone just needs its own version bumped to look at it again.
    base.map.source.needsUpdate = base.data.source.needsUpdate = true;
    for (const texture of base.clones) texture.version++;
    for (const refresh of base.waiting) redraws.add(refresh);
    base.clones = base.waiting = null;
  }
  if (queue.length) { idle(pump); return; }
  // One redraw per waiting plant once everything is in, not one per surface.
  for (const refresh of redraws) refresh();
  redraws.clear();
  for (const resolve of settled.splice(0)) resolve();
}

/** Resolves once every procedural plant surface has its final detail. */
const plantSurfacesReady = () => queue.length ? new Promise(resolve => settled.push(resolve)) : Promise.resolve();

/** Paint an sRGB pigment map and one linear data map (R relief for bumpMap,
 * G roughness for roughnessMap) once per surface kind. Every model owns cheap
 * clones: they share the Source, so identical pots share one GPU upload that
 * is released when the last clone is disposed. */
function surface(key, [width, height], repeat, spec, refresh) {
  let base = surfaces.get(key);
  const saved = base ? null : savedSurface(key, width, height);
  if (saved) {
    // The final painting of an earlier launch: no preview, nothing to repaint.
    base = { map:dataTexture(saved.pigment, width, height, THREE.SRGBColorSpace, repeat),
      data:dataTexture(saved.data, width, height, THREE.NoColorSpace, repeat), clones:null, waiting:null };
    surfaces.set(key, base);
  } else if (!base) {
    const pigment = new Uint8Array(width * height * 4), data = new Uint8Array(pigment.length);
    // Coarse preview: the same painter on an 8px lattice, spread bilinearly
    // (and wrapped around a lathe), at about 1/64 of the full cost.
    if (!rustPlantLattice(getRustDecorCore(), spec, width, height, repeat, pigment, data)) throw new Error(SURFACE_ERROR);
    base = { map:dataTexture(pigment, width, height, THREE.SRGBColorSpace, repeat), data:dataTexture(data, width, height, THREE.NoColorSpace, repeat),
      clones:[], waiting:[] };
    surfaces.set(key, base);
    queue.push({ base, key, width, height, row:0, spec, pigment, data });
    if (queue.length === 1) idle(pump);
  }
  // Texture.copy() raises the shared Source's version, which would re-upload
  // the image for every clone; keep it, so identical surfaces share one upload.
  const clone = texture => {
    const version = texture.source.version, copy = texture.clone();
    copy.source.version = version; base.clones?.push(copy);
    // A cancelled inspection may release a clone before its shared painter
    // finishes. Do not retain it or mark a disposed GPU texture for upload.
    const released = () => {
      const index = base.clones?.indexOf(copy) ?? -1;
      if (index >= 0) base.clones.splice(index, 1);
      copy.removeEventListener('dispose', released);
    };
    if (base.clones) copy.addEventListener('dispose', released);
    return copy;
  };
  if (refresh) base.waiting?.push(refresh);
  return { map:clone(base.map), data:clone(base.data) };
}


return {surface:(key,width,height,repeat,spec,refresh)=>surface(key,[width,height],repeat,spec,refresh),pump,ready:plantSurfacesReady,state:{surfaces,queue,settled,redraws}};
}
