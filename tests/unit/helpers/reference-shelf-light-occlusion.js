// Frozen original of the numeric half of src/js/shelf-light-occlusion.js from before the cabinet
// description and the per-render uniforms moved to the Rust core (rust-core/src/shelf_occluder.rs).
// The shader patch is left out: it does not compute anything. Do not update to match the kernel.
import * as THREE from 'three';

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
/** The cabinet's boards, sides and front, from its units' parts, in the
 * cabinet's own units: walnut boards and sides are solid, a BAGGEBO's mesh
 * shelves pass half the light. `root` is one unit, or a group of units. */
export function shelfOccluders(root) {
  if (!root) return null;
  const units = Array.isArray(root.userData?.parts) ? [[root, new THREE.Matrix4()]]
    : root.children.filter(child => Array.isArray(child.userData?.parts)).map(child => { child.updateMatrix(); return [child, child.matrix]; });
  const bounds = new THREE.Box3(), box = new THREE.Box3(), heights = new Set(), sides = [];
  let solid = false, mesh = false;
  for (const [unit, matrix] of units) {
    for (const part of unit.userData.parts) {
      if (!part?.bounds) continue;
      box.copy(part.bounds).applyMatrix4(matrix);
      bounds.union(box);
      if (/^(shelf-\d+-board|top-cap)$/.test(part.name)) { heights.add(+((box.min.y + box.max.y) / 2).toFixed(3)); solid = true; }
      else if (/^(shelf-\d+-mesh|top-mesh)$/.test(part.name)) { heights.add(+((box.min.y + box.max.y) / 2).toFixed(3)); mesh = true; }
      else if (/^(left|right)-upright$/.test(part.name)) sides.push((box.min.x + box.max.x) / 2);
    }
  }
  if (!heights.size) return null;
  const centre = bounds.getCenter(new THREE.Vector3()), half = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
  return {
    centre, half,
    boards:[...heights].sort((a, b) => a - b).slice(0, MAX_SHELF_BOARDS).map(height => height - centre.y),
    inner:sides.length ? Math.max(...sides.map(x => Math.abs(x - centre.x))) : half.x,
    front:bounds.max.z - centre.z,
    solidSides:sides.length > 0,
    through:solid && !mesh ? 0 : .5
  };
}

const point = new THREE.Vector3(), direction = new THREE.Vector3(), scale = new THREE.Vector3();
const toView = new THREE.Matrix4();
/** Fills the uniforms for one render with `camera`: call from the scene's
 * onBeforeRender, and clear() from its onAfterRender. */
export function applyShelfOccluders(root, description, camera) {
  if (!root || !description) { clearShelfOccluders(); return; }
  root.updateWorldMatrix(true, false);
  toView.multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld);
  scale.setFromMatrixScale(root.matrixWorld);
  const unit = (scale.x + scale.y + scale.z) / 3;
  for (let axis = 0; axis < 3; axis++) {
    direction.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0).transformDirection(toView);
    cabinet[axis * 4] = direction.x; cabinet[axis * 4 + 1] = direction.y; cabinet[axis * 4 + 2] = direction.z;
  }
  cabinet[3] = 1; cabinet[7] = description.inner * unit; cabinet[11] = description.front * unit;
  point.copy(description.centre).applyMatrix4(toView);
  cabinet[12] = point.x; cabinet[13] = point.y; cabinet[14] = point.z; cabinet[15] = description.solidSides ? 1 : 0;
  cabinet[16] = description.half.x * unit; cabinet[17] = description.half.y * unit; cabinet[18] = description.half.z * unit;
  cabinet[19] = description.through;
  boards.fill(FAR);
  description.boards.forEach((height, index) => { boards[index] = height * unit; });
}

export function clearShelfOccluders() { cabinet[3] = 0; }

/** For tests: the current uniform values. */
export const shelfOcclusionUniforms = () => ({ cabinet, boards });
