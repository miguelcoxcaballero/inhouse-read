// The cover relief's passes as generators, for tests and benches: each one is a job of the shelf module
// (rust-ui/src/relief_job.rs) stepped to its end, pausing where the job asks. src/js/cover-relief.js exported
// these while its flows drove the jobs through them; rust-ui/src/relief_flow.rs now makes and steps the jobs
// itself (tests/unit/cover-relief-flow-differential.test.js compares it with the frozen flows), so the page no
// longer carries them. They remain the way a test reaches one pass on its own.
import { needRustShelf } from '../../../src/js/rust-shelf.js';

/** Run a generator to its end synchronously. */
export function drain(task) {
  for (let step = task.next(); ; step = task.next()) if (step.done) return step.value;
}

/** Step a job of the shelf module to its end, pausing where it asks; it is freed however this ends. */
function* run(make) {
  const job = make(needRustShelf().ReliefJob);
  try { for (let code; (code = job.step()) !== 0;) { if (code < 0) throw job.error(); yield; } return job.result(); }
  finally { job.free(); }
}

/** Up to ten distinct supported colours of a cover raster. */
export function* analyzePixels(image) { return yield* run(Job => Job.analysis(image)); }

/** The maps of one choice: a saved colour, several layers or a legacy record. */
export function* buildMapsFromPixels(work, hires, selection) { return yield* run(Job => Job.build(work, hires, selection)); }

/** The classified colour ownership recomposed with a selection's intensities. */
export function* composeReliefLayerPixels(maps, selection) { return yield* run(Job => Job.compose(maps, selection)); }

/** Tangent-space normals (RGBA bytes) from the height map; +x right, +y up the cover. */
export function* heightToNormals(maps, { gain = 1, selectionAlpha = false } = {}) {
  const { width, height } = maps;
  const unit = needRustShelf().relief_normal_unit(width, height, gain);
  return yield* run(Job => Job.normals(maps, unit, selectionAlpha));
}

/** Packed R clearcoat, G roughness ratio, B metalness, A clearcoat-roughness ratio. */
export function* composeMaterialMap(maps, { clearcoat = 0, roughness = .5, clearcoatRoughness = .18 } = {}) {
  return yield* run(Job => Job.material(maps, clearcoat, roughness, clearcoatRoughness));
}

/** Shaded preview, lit from the top-left, as RGBA bytes. */
export function* shadePreview(image, maps, { slope = 7 } = {}) {
  return yield* run(Job => Job.preview(image, maps, slope));
}
