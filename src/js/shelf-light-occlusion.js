import * as THREE from 'three';
import { getRustCore } from './rust-core.js';
import { getRustShelf, needRustShelf, whenRustShelf } from './rust-shelf.js';

/**
 * Solid boards and panels stop a shelf lamp's light. Only two cones have a
 * shadow map (each costs a texture unit in every lit program, of which a
 * phone has few) and a filament's area lights cannot have one: without this,
 * every lamp lit the compartments above and below it and the wall outside
 * the cabinet, so a lamp switched off still looked lit by its neighbours'
 * leaks and a lamp switched on could look dark.
 *
 * The test is a fixed, branch-light sum per light and pixel, with no loop and
 * no indexed uniform (a per-board loop inside three's unrolled light loops
 * ran at well under 2 fps): the lamp's compartment lies between the nearest
 * boards below and above it. A surface in that compartment is lit; one at
 * another height only through the cabinet's open front; beside or behind a
 * walnut cabinet, its solid sides and back stop the light. A BAGGEBO's
 * expanded-metal shelves pass half the light and its sides are open.
 * The room's own lights stand outside the cabinet and are left as they were;
 * with no cabinet (the catalogue's studio) nothing changes. Only uniforms
 * change between frames, never a program.
 */
export const MAX_SHELF_BOARDS = 8;
const FAR = 1e6;
// 0: x axis in view space (w: 1 when a cabinet is set); 1: y axis (w: half
// the inner width); 2: z axis (w: the front, from the centre); 3: centre in
// view space (w: 1 when the sides are solid); 4: half size (w: the fraction
// of light a board lets through). Distances in view units.
const cabinet = new Float32Array(5 * 4);
// The boards' mid-planes along y, from the centre; unused ones far above.
const boards = new Float32Array(MAX_SHELF_BOARDS).fill(FAR);
const SHADERS = ['standard', 'physical', 'lambert', 'phong', 'toon'];

let installed = false;
/** Adds the test to three's light chunks and its uniforms to the lit
 * materials. Must run before any lit program is compiled. */
export function installShelfLightOcclusion(shelf = getRustShelf()) {
  if (installed || !shelf) return;
  installed = true;
  const chunks = THREE.ShaderChunk;
  // The test's text and the guards are Rust (rust-ui/src/shelf_light_rig.rs): nothing when a later three
  // renamed a light's line, only the declarations when it renamed the surface position's.
  const patched = shelf.shelf_lamp_occlusion_patch(chunks.lights_pars_begin, chunks.lights_fragment_begin);
  if (!patched) return;
  chunks.lights_pars_begin = patched[0];
  if (patched[1] === undefined) return;
  chunks.lights_fragment_begin = patched[1];
  // A Float32Array is shared, not cloned, by every material's uniforms.
  for (const name of SHADERS) {
    const uniforms = THREE.ShaderLib[name]?.uniforms;
    if (!uniforms) continue;
    uniforms.shelfLampCabinet = { value:cabinet };
    uniforms.shelfLampBoards = { value:boards };
  }
}
// With the shelf module already in, now; else the moment it arrives, before anything that awaited it runs:
// every lit program is compiled by code that needs that module.
whenRustShelf(installShelfLightOcclusion);

// The numbers are the core's (rust-core/src/shelf_occluder.rs); the first shelf render awaits that
// core. The scene graph, the part-name classification and the uniform arrays stay here.
const core = () => {
  const loaded = getRustCore();
  if (!loaded) throw new Error('El módulo numérico no está cargado. Recarga la página.');
  return loaded;
};
const DESCRIPTION = 19, FRAME_INPUT = 51, FRAME_OUTPUT = 28;

/** The cabinet's boards, sides and front, from its units' parts, in the
 * cabinet's own units: walnut boards and sides are solid, a BAGGEBO's mesh
 * shelves pass half the light. `root` is one unit, or a group of units. */
export function shelfOccluders(root) {
  if (!root) return null;
  const units = Array.isArray(root.userData?.parts) ? [[root, new THREE.Matrix4()]]
    : root.children.filter(child => Array.isArray(child.userData?.parts)).map(child => { child.updateMatrix(); return [child, child.matrix]; });
  const matrices = units.flatMap(([, matrix]) => matrix.elements);
  // The parts' roles (boards, mesh shelves, uprights) and boxes are read in Rust (rust-ui/src/shelf_light_rig.rs).
  const records = needRustShelf().occluder_records(units.map(([unit]) => unit.userData.parts));
  const wasm = core(), inputLength = matrices.length + records.length, length = inputLength + DESCRIPTION, pointer = wasm.alloc_f64(length);
  if (!pointer) throw new Error('El módulo numérico no pudo reservar memoria. Recarga la página.');
  try {
    const input = new Float64Array(wasm.memory.buffer, pointer, inputLength);
    input.set(matrices); input.set(records, matrices.length);
    const count = wasm.shelf_occluders_describe(units.length, records.length / 8, pointer, pointer + inputLength * 8);
    if (!count) return null;
    const out = new Float64Array(wasm.memory.buffer, pointer + inputLength * 8, DESCRIPTION);
    return {
      centre:new THREE.Vector3(out[1], out[2], out[3]), half:new THREE.Vector3(out[4], out[5], out[6]),
      boards:Array.from(out.subarray(11, 11 + count)), inner:out[7], front:out[8], solidSides:out[9] === 1, through:out[10]
    };
  } finally { wasm.free_f64(pointer, length); }
}

// One small arena per core serves every render; it is allocated by the first one.
let frame = null;
function frameViews(wasm) {
  const buffer = wasm.memory.buffer;
  if (frame.buffer === buffer) return;
  frame.buffer = buffer;
  frame.input = new Float64Array(buffer, frame.pointer, FRAME_INPUT);
  frame.cabinet = new Float64Array(buffer, frame.pointer + FRAME_INPUT * 8, cabinet.length);
  frame.boards = new Float64Array(buffer, frame.pointer + (FRAME_INPUT + cabinet.length) * 8, boards.length);
}
/** Fills the uniforms for one render with `camera`: call from the scene's
 * onBeforeRender, and clear() from its onAfterRender. */
export function applyShelfOccluders(root, description, camera) {
  if (!root || !description) { clearShelfOccluders(); return; }
  root.updateWorldMatrix(true, false);
  const wasm = core();
  if (frame?.core !== wasm) {
    const pointer = wasm.alloc_f64(FRAME_INPUT + FRAME_OUTPUT);
    if (!pointer) throw new Error('El módulo numérico no pudo reservar memoria. Recarga la página.');
    if (frame) frame.core.free_f64(frame.pointer, FRAME_INPUT + FRAME_OUTPUT);
    frame = { core:wasm, pointer, buffer:null };
  }
  frameViews(wasm);
  const { centre, half, boards:heights } = description, input = frame.input;
  input.set(camera.matrixWorldInverse.elements); input.set(root.matrixWorld.elements, 16);
  input[32] = centre.x; input[33] = centre.y; input[34] = centre.z;
  input[35] = half.x; input[36] = half.y; input[37] = half.z;
  input[38] = description.inner; input[39] = description.front;
  input[40] = description.solidSides ? 1 : 0; input[41] = description.through;
  input[42] = Math.min(MAX_SHELF_BOARDS, heights.length);
  for (let index = 0; index < MAX_SHELF_BOARDS && index < heights.length; index++) input[43 + index] = heights[index];
  wasm.shelf_occluders_apply(frame.pointer, frame.pointer + FRAME_INPUT * 8);
  frameViews(wasm);
  cabinet.set(frame.cabinet); boards.set(frame.boards);
}

export function clearShelfOccluders() { cabinet[3] = 0; }

/** For tests: the current uniform values. */
export const shelfOcclusionUniforms = () => ({ cabinet, boards });
