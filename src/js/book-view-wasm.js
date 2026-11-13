import { getRustCore, loadedRustCore } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';

// Host side of a view's arithmetic (rust-core/src/book_view.rs, run inside the shelf module by
// rust-ui/src/book_view_plan.rs). The host measures (matrices, bounds, objects); the numbers and decisions come
// back from Rust. One arena of the module's memory is used for the life of the page: every kernel has its own
// region, so a measurement taken in the middle of a plan cannot overwrite the plan's inputs. The view over the
// arena is remade only when the module's memory has grown.
const REGION = { plan: 0, frame: 16, copy: 50, pose: 70, fit: 94, corners: 102, page: 213, zoom: 271, reading: 290 };
let rust, memory, buffer, numbers;
/** The arena as it is now. */
function view() {
  if (!rust) { rust = needRustShelf(); memory = rust.book_mesh_memory(); }
  if (buffer !== memory.buffer) { buffer = memory.buffer; numbers = new Float64Array(buffer, rust.book_view_arena(), 304); }
  return numbers;
}

/** Pixel ratio and the sizes of a view's canvas and compact windows. */
export function planBookView({ shelf, devicePixelRatio, innerWidth, viewportWidth, viewportHeight, width, height, thickness }) {
  view().set([shelf ? 1 : 0, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, innerWidth, viewportWidth, viewportHeight,
    width, height, thickness], REGION.plan);
  rust.book_view_run(REGION.plan);
  const out = view();
  return { pixelRatio: out[REGION.plan + 8], canvasWidth: out[REGION.plan + 9], canvasHeight: out[REGION.plan + 10],
    compactWidth: out[REGION.plan + 11], closedCompactWidth: out[REGION.plan + 12], compactHeight: out[REGION.plan + 13] };
}

/** Whether the viewport, the frame and the pixel ratio all fall on whole physical pixels. Seven numbers in, one flag
 * out: the numeric core's raw export answers it in 31-34 ns, the shelf module's generated wrapper in 36-45 ns, so it stays. */
export function frameAligned(viewportWidth, viewportHeight, ratio, x, y, width, height) {
  return (getRustCore() ?? loadedRustCore()).book_frame_aligned(viewportWidth, viewportHeight, ratio, x, y, width, height) === 1;
}

/** Screen bounds [left, top, right, bottom] of up to three boxes: `{min, max, matrix?}` with
 * Vector3-like corners and an optional world matrix's elements, through the camera. */
export function boxScreenBounds(boxes, camera, viewportWidth, viewportHeight, offset) {
  const v = view(), base = REGION.corners;
  v.set([viewportWidth, viewportHeight, offset?.left ?? 0, offset?.top ?? 0], base);
  v.set(camera.matrixWorldInverse.elements, base + 4);
  v.set(camera.projectionMatrix.elements, base + 20);
  v[base + 36] = boxes.length; v[base + 37] = offset ? 1 : 0;
  boxes.forEach(({ min, max, matrix }, n) => {
    const record = base + 38 + n * 23;
    v.set([min.x, min.y, min.z, max.x, max.y, max.z, matrix ? 1 : 0], record);
    if (matrix) v.set(matrix, record + 7);
  });
  rust.book_view_run(base);
  const out = view();
  return [out[base + 107], out[base + 108], out[base + 109], out[base + 110]];
}

/** The window of the framebuffer a return needs. `bounds()` measures the book on demand,
 * only when the cheap checks have not already decided on the whole viewport. */
export function planReturnFrame(input, bounds) {
  const base = REGION.frame;
  const write = known => {
    view().set([input.compact ? 1 : 0, input.direct ? 1 : 0, input.adaptive ? 1 : 0, input.measureOnly ? 1 : 0, input.scale,
      input.ratio, input.viewportWidth, input.viewportHeight, input.coverOpen, input.closedWidth, input.openWidth,
      input.height, known ? 1 : 0, ...(known ?? [0, 0, 0, 0]),
      input.motion ? 1 : 0, input.motion?.width ?? 0, input.motion?.height ?? 0,
      input.native ? 1 : 0, input.native?.width ?? 0, input.native?.height ?? 0], base);
  };
  write(null);
  let code = rust.book_view_run(base);
  if (code === 2) { write(bounds()); code = rust.book_view_run(base); }
  const out = view();
  // The reservations grow even when the answer is the whole viewport.
  if (input.motion) { input.motion.width = out[base + 29]; input.motion.height = out[base + 30]; }
  if (input.native) { input.native.width = out[base + 32]; input.native.height = out[base + 33]; }
  return code === 1 ? { x: out[base + 24], y: out[base + 25], width: out[base + 26], height: out[base + 27] } : null;
}

/** The rectangle of the framebuffer copied to the snapshot canvas; null copies it all. */
export function planCopyRectangle(input, bounds) {
  const base = REGION.copy;
  const write = known => view().set([input.viewportWidth, input.viewportHeight, input.ratio, input.canvasWidth,
    input.canvasHeight, input.frame.x, input.frame.y, input.frame.width, input.frame.height, known ? 1 : 0,
    ...(known ?? [0, 0, 0, 0]), input.scale], base);
  write(null);
  let code = rust.book_view_run(base);
  if (code === 2) { write(bounds()); code = rust.book_view_run(base); }
  const out = view();
  return code === 1 ? { x: out[base + 16], y: out[base + 17], width: out[base + 18], height: out[base + 19] } : null;
}

/** Where the model stands for a pose, with the opening, withdrawal and page theme clamped. */
export function planBookPose(pose, current, centerX, centerY, viewportWidth, viewportHeight, pageTheme) {
  const base = REGION.pose;
  view().set([pose.coverOpen ?? current?.coverOpen ?? 0, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0,
    centerX, centerY, viewportWidth, viewportHeight, pose.x, pose.y, pose.pitch ?? 0, pose.angle, pose.roll ?? 0, pose.scale,
    pose.pageTheme != null ? 1 : 0, Number(pose.pageTheme), pageTheme], base);
  rust.book_view_run(base);
  const out = view();
  return { opening: out[base + 15], withdrawal: out[base + 16], x: out[base + 17], y: out[base + 18],
    rotationX: out[base + 19], rotationY: out[base + 20], rotationZ: out[base + 21], scale: out[base + 22], pageTheme: out[base + 23] };
}

export function fitImage(imageWidth, imageHeight, width, height) {
  const base = REGION.fit;
  view().set([imageWidth, imageHeight, width, height], base);
  rust.book_view_run(base);
  const out = view();
  return { x: out[base + 4], y: out[base + 5], width: out[base + 6], height: out[base + 7] };
}

/** Screen bounds of a plane, as { left, top, width, height }. */
export function planPageBounds(width, height, viewportWidth, viewportHeight, offset, world, camera) {
  const v = view(), base = REGION.page;
  v.set([width, height, viewportWidth, viewportHeight, offset.left, offset.top], base);
  v.set(world, base + 6); v.set(camera.matrixWorldInverse.elements, base + 22); v.set(camera.projectionMatrix.elements, base + 38);
  rust.book_view_run(base);
  const out = view();
  return { left: out[base + 54], top: out[base + 55], width: out[base + 56], height: out[base + 57] };
}

/** The pose that lays the page over `target` in the reader, or null when either has no area. */
export function planPageZoom(bounds, target, offset, centerX, centerY, origin) {
  const base = REGION.zoom;
  view().set([bounds.left, bounds.top, bounds.width, bounds.height, target?.left, target?.top, target?.width, target?.height,
    offset.left, offset.top, centerX, centerY, origin.x, origin.y, origin.scale], base);
  if (rust.book_view_run(base) !== 1) return null;
  const out = view();
  return { x: out[base + 16], y: out[base + 17], scale: out[base + 18] };
}

/** The pose of a book opened flat with its whole spread in view. */
export function planReadingPose(width, height, thickness, viewportWidth, viewportHeight, centerX, centerY) {
  const base = REGION.reading;
  view().set([width, height, thickness, viewportWidth, viewportHeight, centerX, centerY], base);
  rust.book_view_run(base);
  const out = view();
  return { x: out[base + 7], y: out[base + 8], scale: out[base + 9] };
}
