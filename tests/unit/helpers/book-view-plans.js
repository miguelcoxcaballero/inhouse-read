// Three plans of a view that the page no longer asks for: the shelf module computes a view's sizes, its page's
// bounds and the zoom onto the reader's page from its own kernels (rust-ui/src/book_view_host.rs over
// book_view_plan.rs). For tests, the wrappers src/js/book-view-wasm.js had, over the same arena of the module
// (book_view_run still runs every region), and the page projection as production now makes it.
import { needRustShelf } from '../../../src/js/rust-shelf.js';

const REGION = { plan: 0, page: 213, zoom: 271 };
let rust, memory, buffer, numbers;
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

/** The fitted page image on screen, as the shelf module projects it for a view (book_view_page_bounds): the
 * view's canvas gives the offset, its model the page. */
export const projectBookPageBounds = (page, camera, viewportWidth, viewportHeight, offset = { left:0, top:0 }) =>
  needRustShelf().book_view_page_bounds({ canvas:{ getBoundingClientRect:() => offset }, model:{ userData:{ pageSurface:page } },
    camera, viewportWidth, viewportHeight });
