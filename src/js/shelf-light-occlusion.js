import * as THREE from 'three';
import { getRustCore } from './rust-core.js';

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

// The numbers are the core's (rust-core/src/shelf_occluder.rs); the first shelf render awaits that
// core. The scene graph, the part-name classification and the uniform arrays stay here.
const core = () => {
  const loaded = getRustCore();
  if (!loaded) throw new Error('El módulo numérico no está cargado. Recarga la página.');
  return loaded;
};
const DESCRIPTION = 19, FRAME_INPUT = 51, FRAME_OUTPUT = 28;
const partKind = name => /^(shelf-\d+-board|top-cap)$/.test(name) ? 1 : /^(shelf-\d+-mesh|top-mesh)$/.test(name) ? 2 : /^(left|right)-upright$/.test(name) ? 3 : 0;

/** The cabinet's boards, sides and front, from its units' parts, in the
 * cabinet's own units: walnut boards and sides are solid, a BAGGEBO's mesh
 * shelves pass half the light. `root` is one unit, or a group of units. */
export function shelfOccluders(root) {
  if (!root) return null;
  const units = Array.isArray(root.userData?.parts) ? [[root, new THREE.Matrix4()]]
    : root.children.filter(child => Array.isArray(child.userData?.parts)).map(child => { child.updateMatrix(); return [child, child.matrix]; });
  const matrices = [], records = [];
  units.forEach(([unit, matrix], index) => {
    matrices.push(...matrix.elements);
    for (const part of unit.userData.parts) {
      if (!part?.bounds) continue;
      const { min, max } = part.bounds;
      records.push(index, partKind(part.name), min.x, min.y, min.z, max.x, max.y, max.z);
    }
  });
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
    frame = { core:wasm, pointer };
  }
  const { centre, half, boards:heights } = description, input = new Float64Array(wasm.memory.buffer, frame.pointer, FRAME_INPUT);
  input.set(camera.matrixWorldInverse.elements); input.set(root.matrixWorld.elements, 16);
  input.set([centre.x, centre.y, centre.z, half.x, half.y, half.z, description.inner, description.front, description.solidSides ? 1 : 0, description.through,
    Math.min(MAX_SHELF_BOARDS, heights.length)], 32);
  for (let index = 0; index < MAX_SHELF_BOARDS && index < heights.length; index++) input[43 + index] = heights[index];
  wasm.shelf_occluders_apply(frame.pointer, frame.pointer + FRAME_INPUT * 8);
  const output = new Float64Array(wasm.memory.buffer, frame.pointer + FRAME_INPUT * 8, FRAME_OUTPUT);
  cabinet.set(output.subarray(0, 20)); boards.set(output.subarray(20));
}

export function clearShelfOccluders() { cabinet[3] = 0; }

/** For tests: the current uniform values. */
export const shelfOcclusionUniforms = () => ({ cabinet, boards });
