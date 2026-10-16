import { getRustCore, loadedRustCore } from './rust-core.js';
import { scratchArena } from './core-tables.js';

// Host side of rust-core/src/book_view.rs. The host measures (matrices, bounds, objects);
// the numbers and decisions come back from the core. One small arena per core is kept for
// the life of the page: every kernel has its own region, so a measurement taken in the
// middle of a plan cannot overwrite the plan's inputs. Views are rebuilt per call, because
// any kernel may grow the memory.
const REGION = { plan: 0, frame: 16, copy: 50, pose: 70, fit: 94, corners: 102, page: 213, zoom: 271, reading: 290 };
const arenas = new WeakMap();
function arena() {
  const core = getRustCore() ?? loadedRustCore();
  let known = arenas.get(core);
  if (!known) arenas.set(core, known = scratchArena(core, 304));
  return { core, pointer: known.pointer, view: known.view };
}
const at = (context, region) => context.pointer + region * 8;

/** Pixel ratio and the sizes of a view's canvas and compact windows. */
export function planBookView({ shelf, devicePixelRatio, innerWidth, viewportWidth, viewportHeight, width, height, thickness }) {
  const context = arena(), v = context.view();
  v.set([shelf ? 1 : 0, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, innerWidth, viewportWidth, viewportHeight,
    width, height, thickness], REGION.plan);
  context.core.book_view_plan(at(context, REGION.plan));
  const out = context.view();
  return { pixelRatio: out[REGION.plan + 8], canvasWidth: out[REGION.plan + 9], canvasHeight: out[REGION.plan + 10],
    compactWidth: out[REGION.plan + 11], closedCompactWidth: out[REGION.plan + 12], compactHeight: out[REGION.plan + 13] };
}

/** Whether the viewport, the frame and the pixel ratio all fall on whole physical pixels. */
export function frameAligned(viewportWidth, viewportHeight, ratio, x, y, width, height) {
  return (getRustCore() ?? loadedRustCore()).book_frame_aligned(viewportWidth, viewportHeight, ratio, x, y, width, height) === 1;
}

/** Screen bounds [left, top, right, bottom] of up to three boxes: `{min, max, matrix?}` with
 * Vector3-like corners and an optional world matrix's elements, through the camera. */
export function boxScreenBounds(boxes, camera, viewportWidth, viewportHeight, offset) {
  const context = arena(), v = context.view(), base = REGION.corners;
  v.set([viewportWidth, viewportHeight, offset?.left ?? 0, offset?.top ?? 0], base);
  v.set(camera.matrixWorldInverse.elements, base + 4);
  v.set(camera.projectionMatrix.elements, base + 20);
  v[base + 36] = boxes.length; v[base + 37] = offset ? 1 : 0;
  boxes.forEach(({ min, max, matrix }, n) => {
    const record = base + 38 + n * 23;
    v.set([min.x, min.y, min.z, max.x, max.y, max.z, matrix ? 1 : 0], record);
    if (matrix) v.set(matrix, record + 7);
  });
  context.core.book_corner_bounds(at(context, base));
  const out = context.view();
  return [out[base + 107], out[base + 108], out[base + 109], out[base + 110]];
}

/** The window of the framebuffer a return needs. `bounds()` measures the book on demand,
 * only when the cheap checks have not already decided on the whole viewport. */
export function planReturnFrame(input, bounds) {
  const context = arena(), base = REGION.frame;
  const write = known => {
    const v = context.view();
    v.set([input.compact ? 1 : 0, input.direct ? 1 : 0, input.adaptive ? 1 : 0, input.measureOnly ? 1 : 0, input.scale,
      input.ratio, input.viewportWidth, input.viewportHeight, input.coverOpen, input.closedWidth, input.openWidth,
      input.height, known ? 1 : 0, ...(known ?? [0, 0, 0, 0]),
      input.motion ? 1 : 0, input.motion?.width ?? 0, input.motion?.height ?? 0,
      input.native ? 1 : 0, input.native?.width ?? 0, input.native?.height ?? 0], base);
  };
  write(null);
  let code = context.core.book_return_frame(at(context, base));
  if (code === 2) { write(bounds()); code = context.core.book_return_frame(at(context, base)); }
  const out = context.view();
  // The reservations grow even when the answer is the whole viewport.
  if (input.motion) { input.motion.width = out[base + 29]; input.motion.height = out[base + 30]; }
  if (input.native) { input.native.width = out[base + 32]; input.native.height = out[base + 33]; }
  return code === 1 ? { x: out[base + 24], y: out[base + 25], width: out[base + 26], height: out[base + 27] } : null;
}

/** The rectangle of the framebuffer copied to the snapshot canvas; null copies it all. */
export function planCopyRectangle(input, bounds) {
  const context = arena(), base = REGION.copy;
  const write = known => context.view().set([input.viewportWidth, input.viewportHeight, input.ratio, input.canvasWidth,
    input.canvasHeight, input.frame.x, input.frame.y, input.frame.width, input.frame.height, known ? 1 : 0,
    ...(known ?? [0, 0, 0, 0]), input.scale], base);
  write(null);
  let code = context.core.book_copy_rectangle(at(context, base));
  if (code === 2) { write(bounds()); code = context.core.book_copy_rectangle(at(context, base)); }
  const out = context.view();
  return code === 1 ? { x: out[base + 16], y: out[base + 17], width: out[base + 18], height: out[base + 19] } : null;
}

/** Where the model stands for a pose, with the opening, withdrawal and page theme clamped. */
export function planBookPose(pose, current, centerX, centerY, viewportWidth, viewportHeight, pageTheme) {
  const context = arena(), base = REGION.pose;
  context.view().set([pose.coverOpen ?? current?.coverOpen ?? 0, pose.bookmarkWithdraw ?? current?.bookmarkWithdraw ?? 0,
    centerX, centerY, viewportWidth, viewportHeight, pose.x, pose.y, pose.pitch ?? 0, pose.angle, pose.roll ?? 0, pose.scale,
    pose.pageTheme != null ? 1 : 0, Number(pose.pageTheme), pageTheme], base);
  context.core.book_pose(at(context, base));
  const out = context.view();
  return { opening: out[base + 15], withdrawal: out[base + 16], x: out[base + 17], y: out[base + 18],
    rotationX: out[base + 19], rotationY: out[base + 20], rotationZ: out[base + 21], scale: out[base + 22], pageTheme: out[base + 23] };
}

export function fitImage(imageWidth, imageHeight, width, height) {
  const context = arena(), base = REGION.fit;
  context.view().set([imageWidth, imageHeight, width, height], base);
  context.core.book_fit_image(at(context, base));
  const out = context.view();
  return { x: out[base + 4], y: out[base + 5], width: out[base + 6], height: out[base + 7] };
}

/** Screen bounds of a plane, as { left, top, width, height }. */
export function planPageBounds(width, height, viewportWidth, viewportHeight, offset, world, camera) {
  const context = arena(), v = context.view(), base = REGION.page;
  v.set([width, height, viewportWidth, viewportHeight, offset.left, offset.top], base);
  v.set(world, base + 6); v.set(camera.matrixWorldInverse.elements, base + 22); v.set(camera.projectionMatrix.elements, base + 38);
  context.core.book_page_bounds(at(context, base));
  const out = context.view();
  return { left: out[base + 54], top: out[base + 55], width: out[base + 56], height: out[base + 57] };
}

/** The pose that lays the page over `target` in the reader, or null when either has no area. */
export function planPageZoom(bounds, target, offset, centerX, centerY, origin) {
  const context = arena(), base = REGION.zoom;
  context.view().set([bounds.left, bounds.top, bounds.width, bounds.height, target?.left, target?.top, target?.width, target?.height,
    offset.left, offset.top, centerX, centerY, origin.x, origin.y, origin.scale], base);
  if (context.core.book_page_zoom(at(context, base)) !== 1) return null;
  const out = context.view();
  return { x: out[base + 16], y: out[base + 17], scale: out[base + 18] };
}

/** The pose of a book opened flat with its whole spread in view. */
export function planReadingPose(width, height, thickness, viewportWidth, viewportHeight, centerX, centerY) {
  const context = arena(), base = REGION.reading;
  context.view().set([width, height, thickness, viewportWidth, viewportHeight, centerX, centerY], base);
  context.core.book_reading_pose(at(context, base));
  const out = context.view();
  return { x: out[base + 7], y: out[base + 8], scale: out[base + 9] };
}
