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
const SHADERS = ['standard', 'physical', 'lambert', 'phong', 'toon'];

const PARS = `
uniform vec4 shelfLampCabinet[ 5 ];
uniform vec4 shelfLampBoards[ 2 ];
vec3 shelfLampLocal( const in vec3 position ) {
	vec3 offset = position - shelfLampCabinet[ 3 ].xyz;
	return vec3( dot( offset, shelfLampCabinet[ 0 ].xyz ), dot( offset, shelfLampCabinet[ 1 ].xyz ), dot( offset, shelfLampCabinet[ 2 ].xyz ) );
}
// point: the surface in the cabinet's frame, computed once per pixel.
float shelfLampOcclusion( const in vec3 point, const in vec3 lampPosition ) {
	if ( shelfLampCabinet[ 0 ].w < 0.5 ) return 1.0;
	vec3 lamp = shelfLampLocal( lampPosition );
	if ( any( greaterThan( abs( lamp ), shelfLampCabinet[ 4 ].xyz ) ) ) return 1.0;
	vec4 lowA = step( shelfLampBoards[ 0 ], vec4( lamp.y ) ), lowB = step( shelfLampBoards[ 1 ], vec4( lamp.y ) );
	vec4 belowA = mix( vec4( -${FAR.toFixed(1)} ), shelfLampBoards[ 0 ], lowA ), belowB = mix( vec4( -${FAR.toFixed(1)} ), shelfLampBoards[ 1 ], lowB );
	vec4 aboveA = mix( shelfLampBoards[ 0 ], vec4( ${FAR.toFixed(1)} ), lowA ), aboveB = mix( shelfLampBoards[ 1 ], vec4( ${FAR.toFixed(1)} ), lowB );
	vec4 belowAll = max( belowA, belowB ), aboveAll = min( aboveA, aboveB );
	float below = max( max( belowAll.x, belowAll.y ), max( belowAll.z, belowAll.w ) );
	float above = min( min( aboveAll.x, aboveAll.y ), min( aboveAll.z, aboveAll.w ) );
	float through = shelfLampCabinet[ 4 ].w, inner = shelfLampCabinet[ 1 ].w, front = shelfLampCabinet[ 2 ].w;
	if ( point.y > below && point.y < above ) {
		// A walnut cabinet's solid sides and back.
		return shelfLampCabinet[ 3 ].w > 0.5 && ( abs( point.x ) > inner && point.z < front || point.z < - shelfLampCabinet[ 4 ].z ) ? through : 1.0;
	}
	if ( point.z <= front || lamp.z >= front ) return through;
	vec2 crossing = mix( lamp.xy, point.xy, ( front - lamp.z ) / ( point.z - lamp.z ) );
	return crossing.y > below && crossing.y < above && abs( crossing.x ) < inner ? 1.0 : through;
}
`;

let installed = false;
/** Adds the test to three's light chunks and its uniforms to the lit
 * materials. Must run before any lit program is compiled. */
export function installShelfLightOcclusion() {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk;
  const begin = chunks.lights_fragment_begin;
  const point = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  const spot = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
  const area = 'rectAreaLight = rectAreaLights[ i ];';
  // A later three that renamed these keeps its own lighting unchanged.
  if (![point, spot, area].every(part => begin.includes(part))) return;
  chunks.lights_pars_begin += PARS;
  const position = 'vec3 geometryPosition = - vViewPosition;';
  if (!begin.includes(position)) return;
  chunks.lights_fragment_begin = begin
    .replace(position, `${position}\nvec3 shelfLampSurface = shelfLampLocal( geometryPosition );`)
    .replace(point, `${point}\n\t\tdirectLight.color *= shelfLampOcclusion( shelfLampSurface, pointLight.position );`)
    .replace(spot, `${spot}\n\t\tdirectLight.color *= shelfLampOcclusion( shelfLampSurface, spotLight.position );`)
    .replace(area, `${area}\n\t\trectAreaLight.color *= shelfLampOcclusion( shelfLampSurface, rectAreaLight.position );`);
  // A Float32Array is shared, not cloned, by every material's uniforms.
  for (const name of SHADERS) {
    const uniforms = THREE.ShaderLib[name]?.uniforms;
    if (!uniforms) continue;
    uniforms.shelfLampCabinet = { value:cabinet };
    uniforms.shelfLampBoards = { value:boards };
  }
}
installShelfLightOcclusion();

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
