import * as THREE from 'three';

/**
 * Solid boards and panels stop a shelf lamp's light. Only two cones have a
 * shadow map (each costs a texture unit in every lit program, of which a
 * phone has few) and a filament's area lights cannot have one: without this,
 * every lamp lit the compartments above and below it and the wall outside
 * the cabinet, so a lamp switched off still looked lit by its neighbours'
 * leaks and a lamp switched on could look dark.
 *
 * Each lit program tests the segment from the surface to every light that
 * stands inside the cabinet against the cabinet's boards and panels (a few
 * rectangles in view space). A BAGGEBO's expanded-metal shelves pass part of
 * the light. The room's own lights stand outside the cabinet and are left as
 * they were; with no cabinet (the catalogue's studio) nothing changes.
 * Only uniforms change between frames, never a program.
 */
export const MAX_SHELF_OCCLUDERS = 24;
// 0-2: the cabinet's x, y and z axes in view space; 3: its centre (w: the
// number of occluders); 4: its half size along those axes.
const frame = new Float32Array(5 * 4);
// Two vec4 per occluder: centre (w: the axis normal to it, 0 = x, 1 = y,
// 2 = z), then its half sizes along the other two axes and the fraction of
// light it lets through.
const occluders = new Float32Array(MAX_SHELF_OCCLUDERS * 2 * 4);
const SHADERS = ['standard', 'physical', 'lambert', 'phong', 'toon'];

const PARS = `
uniform vec4 shelfOccluderFrame[ 5 ];
uniform vec4 shelfOccluders[ ${MAX_SHELF_OCCLUDERS * 2} ];
float shelfLampOcclusion( const in vec3 surface, const in vec3 lamp ) {
	int count = int( shelfOccluderFrame[ 3 ].w + 0.5 );
	if ( count == 0 ) return 1.0;
	vec3 axisX = shelfOccluderFrame[ 0 ].xyz, axisY = shelfOccluderFrame[ 1 ].xyz, axisZ = shelfOccluderFrame[ 2 ].xyz;
	vec3 local = lamp - shelfOccluderFrame[ 3 ].xyz, halfSize = shelfOccluderFrame[ 4 ].xyz;
	if ( abs( dot( local, axisX ) ) > halfSize.x || abs( dot( local, axisY ) ) > halfSize.y || abs( dot( local, axisZ ) ) > halfSize.z ) return 1.0;
	float seen = 1.0;
	for ( int i = 0; i < ${MAX_SHELF_OCCLUDERS}; i ++ ) {
		if ( i >= count ) break;
		vec4 placement = shelfOccluders[ 2 * i ], extent = shelfOccluders[ 2 * i + 1 ];
		int axis = int( placement.w + 0.5 );
		vec3 normal = axis == 0 ? axisX : axis == 1 ? axisY : axisZ;
		float fromSurface = dot( normal, surface - placement.xyz ), fromLamp = dot( normal, lamp - placement.xyz );
		if ( fromSurface * fromLamp >= 0.0 ) continue;
		vec3 crossing = surface + ( lamp - surface ) * ( fromSurface / ( fromSurface - fromLamp ) ) - placement.xyz;
		vec3 first = axis == 0 ? axisY : axisX, second = axis == 2 ? axisY : axisZ;
		if ( abs( dot( first, crossing ) ) <= extent.x && abs( dot( second, crossing ) ) <= extent.y ) seen *= extent.z;
	}
	return seen;
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
  chunks.lights_fragment_begin = begin
    .replace(point, `${point}\n\t\tdirectLight.color *= shelfLampOcclusion( geometryPosition, pointLight.position );`)
    .replace(spot, `${spot}\n\t\tdirectLight.color *= shelfLampOcclusion( geometryPosition, spotLight.position );`)
    .replace(area, `${area}\n\t\trectAreaLight.color *= shelfLampOcclusion( geometryPosition, rectAreaLight.position );`);
  // A Float32Array is shared, not cloned, by every material's uniforms.
  for (const name of SHADERS) {
    const uniforms = THREE.ShaderLib[name]?.uniforms;
    if (!uniforms) continue;
    uniforms.shelfOccluderFrame = { value:frame };
    uniforms.shelfOccluders = { value:occluders };
  }
}
installShelfLightOcclusion();

const AXES = ['x', 'y', 'z'];
/** The cabinet's boards and panels, from its units' parts, in the cabinet's
 * own units: walnut boards and panels are solid, a BAGGEBO's mesh shelves
 * pass half the light. `cabinet` is one unit, or a group of units. */
export function shelfOccluders(cabinet) {
  if (!cabinet) return null;
  const units = Array.isArray(cabinet.userData?.parts) ? [[cabinet, new THREE.Matrix4()]]
    : cabinet.children.filter(child => Array.isArray(child.userData?.parts)).map(child => { child.updateMatrix(); return [child, child.matrix]; });
  const list = [], bounds = new THREE.Box3(), box = new THREE.Box3();
  for (const [unit, matrix] of units) {
    const parts = unit.userData.parts;
    for (const part of parts) {
      if (!part?.bounds) continue;
      box.copy(part.bounds).applyMatrix4(matrix);
      bounds.union(box);
      const solid = /^(shelf-\d+-board|top-cap|left-upright|right-upright|back-backer)$/.test(part.name);
      const mesh = /^(shelf-\d+-mesh|top-mesh)$/.test(part.name);
      if (!solid && !mesh || list.length === MAX_SHELF_OCCLUDERS) continue;
      // A BAGGEBO shelf's folded rim surrounds its mesh: cover the whole outline.
      const rim = mesh && parts.find(other => other.name === part.name.replace(/mesh$/, 'folded-perimeter-rim'));
      const outline = rim ? rim.bounds.clone().applyMatrix4(matrix) : box;
      const size = box.getSize(new THREE.Vector3()), outer = outline.getSize(new THREE.Vector3());
      const sizes = AXES.map(axis => size[axis]), axis = sizes.indexOf(Math.min(...sizes));
      const [first, second] = axis === 0 ? ['y', 'z'] : axis === 1 ? ['x', 'z'] : ['x', 'y'];
      list.push({ centre:box.getCenter(new THREE.Vector3()), axis, halfFirst:outer[first] / 2, halfSecond:outer[second] / 2,
        through:mesh ? .5 : 0 });
    }
  }
  if (!list.length) return null;
  return { list, centre:bounds.getCenter(new THREE.Vector3()), half:bounds.getSize(new THREE.Vector3()).multiplyScalar(.5) };
}

const point = new THREE.Vector3(), direction = new THREE.Vector3(), scale = new THREE.Vector3();
const toView = new THREE.Matrix4();
/** Fills the uniforms for one render with `camera`: call from the scene's
 * onBeforeRender, and clear() from its onAfterRender. */
export function applyShelfOccluders(cabinet, description, camera) {
  if (!cabinet || !description) { clearShelfOccluders(); return; }
  cabinet.updateWorldMatrix(true, false);
  toView.multiplyMatrices(camera.matrixWorldInverse, cabinet.matrixWorld);
  scale.setFromMatrixScale(cabinet.matrixWorld);
  const unit = (scale.x + scale.y + scale.z) / 3;
  for (let axis = 0; axis < 3; axis++) {
    direction.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0).transformDirection(toView);
    frame[axis * 4] = direction.x; frame[axis * 4 + 1] = direction.y; frame[axis * 4 + 2] = direction.z; frame[axis * 4 + 3] = 0;
  }
  point.copy(description.centre).applyMatrix4(toView);
  frame[12] = point.x; frame[13] = point.y; frame[14] = point.z; frame[15] = description.list.length;
  frame[16] = description.half.x * unit; frame[17] = description.half.y * unit; frame[18] = description.half.z * unit; frame[19] = 0;
  description.list.forEach((occluder, index) => {
    const offset = index * 8;
    point.copy(occluder.centre).applyMatrix4(toView);
    occluders[offset] = point.x; occluders[offset + 1] = point.y; occluders[offset + 2] = point.z; occluders[offset + 3] = occluder.axis;
    occluders[offset + 4] = occluder.halfFirst * unit; occluders[offset + 5] = occluder.halfSecond * unit;
    occluders[offset + 6] = occluder.through; occluders[offset + 7] = 0;
  });
}

export function clearShelfOccluders() { frame[15] = 0; }

/** For tests: the current uniform values. */
export const shelfOcclusionUniforms = () => ({ frame, occluders });
