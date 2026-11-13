// Frozen original of the shader patch of src/js/shelf-light-occlusion.js from before its text moved to Rust
// (rust-ui/src/shelf_light_rig.rs, shelf_lamp_occlusion_patch). Only the three namespace and the two uniform
// arrays became parameters and the once-per-page flag was dropped, so a test can patch a copy of three's
// chunks. Do not update to match the Rust.
const FAR = 1e6;
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

export function installShelfLightOcclusion(THREE, cabinet, boards) {
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
