import { ShaderChunk, Vector2, Vector3 } from 'three';

// A covered board is slightly uneven beneath its laminate. Keep that shape
// entirely in the reflection layer: neither the printed image, Lambert light,
// cover silhouette nor shadow geometry should acquire visible bumps.
const CACHE_KEY = 'book-reflection-surface-v1';
const installed = new WeakMap();

function reflectionProfile(seed) {
  const text = String(seed ?? '');
  let state = 2166136261;
  for (let i = 0; i < text.length; i++) state = Math.imul(state ^ text.charCodeAt(i), 16777619);
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  return { phase:new Vector3(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2),
    amplitude:.88 + random() * .24 };
}

const declarations = /* glsl */`
varying vec2 vBookReflectionUv;
uniform vec3 bookReflectionPhase;
uniform float bookReflectionStrength;
vec3 bookReflectionNormal;
vec3 bookReflectionClearcoatNormal;
#ifdef USE_ANISOTROPY
  vec3 bookReflectionAnisotropyT;
  vec3 bookReflectionAnisotropyB;
#endif
`;

// Analytic slopes of three broad, nonparallel height waves (roughly one or
// two waves per cover), rather than a tiled/noisy normal texture. At .018 the
// maximum tilt is about two degrees. Raw geometry UVs make each book's shape
// identical in the shelf, enlarged view and lifted copy, independent of the
// resolution/repeat of its existing paper or cloth texture.
const normalSetup = /* glsl */`
  vec3 bookWaveAngle = vec3(
    dot(vBookReflectionUv, vec2(5.2, 1.7)),
    dot(vBookReflectionUv, vec2(-2.4, 9.0)),
    dot(vBookReflectionUv, vec2(10.9, 5.1))
  ) + bookReflectionPhase;
  vec3 bookWaveCos = cos(bookWaveAngle);
  vec2 bookSlope = bookReflectionStrength * (
    vec2(.72, .2353846154) * bookWaveCos.x +
    vec2(-.2, .75) * bookWaveCos.y +
    vec2(.19, .0888990826) * bookWaveCos.z
  );

  // Recover the UV directions in view space, including curved bindings and
  // mirrored/back faces. Normalize the directions separately so the slope
  // remains small on thin spines as well as broad cover boards. A degenerate
  // UV face contributes zero tilt; guarded lengths cannot introduce NaNs.
  vec3 bookDx = dFdx(-vViewPosition);
  vec3 bookDy = dFdy(-vViewPosition);
  vec2 bookUvDx = dFdx(vBookReflectionUv);
  vec2 bookUvDy = dFdy(vBookReflectionUv);
  vec3 bookDyPerp = cross(bookDy, nonPerturbedNormal);
  vec3 bookDxPerp = cross(nonPerturbedNormal, bookDx);
  vec3 bookT = bookDyPerp * bookUvDx.x + bookDxPerp * bookUvDy.x;
  vec3 bookB = bookDyPerp * bookUvDx.y + bookDxPerp * bookUvDy.y;
  bookT *= inversesqrt(max(dot(bookT, bookT), 1e-20));
  bookB *= inversesqrt(max(dot(bookB, bookB), 1e-20));
  vec3 bookReflectionTilt = bookT * bookSlope.x + bookB * bookSlope.y;
  bookReflectionNormal = normalize(normal - bookReflectionTilt);
  bookReflectionClearcoatNormal = bookReflectionNormal;
  #ifdef USE_CLEARCOAT
    bookReflectionClearcoatNormal = normalize(clearcoatNormal - bookReflectionTilt);
  #endif
`;

const anisotropySetup = /* glsl */`
  #ifdef USE_ANISOTROPY
    // Foil keeps its grain aligned with the tilted reflection surface. The
    // unmodified material frame remains available to all diffuse operations.
    bookReflectionAnisotropyT = normalize(material.anisotropyT - bookReflectionNormal *
      dot(bookReflectionNormal, material.anisotropyT));
    bookReflectionAnisotropyB = normalize(cross(bookReflectionNormal, bookReflectionAnisotropyT));
    bookReflectionAnisotropyB *= dot(bookReflectionAnisotropyB, material.anisotropyB) < 0.0 ? -1.0 : 1.0;
  #endif
`;

// Three r180's physical chunk mixes direct Lambert and GGX in one function.
// Override only the specular terms; retain the original diffuse irradiance,
// indirect multiscattering energy compensation and coat attenuation. This is
// deliberately local to these materials; global ShaderChunks stay untouched.
const physicalPars = ShaderChunk.lights_physical_pars_fragment
  .replaceAll('dot( material.anisotropyT,', 'dot( bookReflectionAnisotropyT,')
  .replaceAll('dot( material.anisotropyB,', 'dot( bookReflectionAnisotropyB,')
  .replace('float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );',
    'float dotNLcc = saturate( dot( bookReflectionClearcoatNormal, directLight.direction ) );')
  .replace('BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material )',
    'BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, bookReflectionClearcoatNormal, material )')
  .replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );',
    `vec3 bookSpecularIrradiance = saturate(dot(bookReflectionNormal, directLight.direction)) * directLight.color;
  reflectedLight.directSpecular += bookSpecularIrradiance * BRDF_GGX( directLight.direction, geometryViewDir, bookReflectionNormal, material );`)
  .replace('clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal,',
    'clearcoatRadiance * EnvironmentBRDF( bookReflectionClearcoatNormal,')
  // The app currently uses point/spot/directional sources. Keep area-light
  // reflections coherent too without changing their diffuse LTC evaluation.
  .replace('vec3 normal = geometryNormal;', 'vec3 normal = bookReflectionNormal;')
  .replace('lightColor * material.diffuseColor * LTC_Evaluate( normal,',
    'lightColor * material.diffuseColor * LTC_Evaluate( geometryNormal,');

const environmentMaps = ShaderChunk.lights_fragment_maps
  .replace('getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB,',
    'getIBLAnisotropyRadiance( geometryViewDir, bookReflectionNormal, material.roughness, bookReflectionAnisotropyB,')
  .replace('getIBLRadiance( geometryViewDir, geometryNormal,',
    'getIBLRadiance( geometryViewDir, bookReflectionNormal,')
  .replace('getIBLRadiance( geometryViewDir, geometryClearcoatNormal,',
    'getIBLRadiance( geometryViewDir, bookReflectionClearcoatNormal,');

/** Add stable, specular-only board waviness to one outer physical material.
 * Install after any existing onBeforeCompile hook (e.g. spine grazing fade).
 * Seed with the book's stable identity, optionally suffixed by surface name.
 * Strength is a dimensionless slope: .018 cover, .014 binding, .010 cap.
 * uvScale converts unnormalized cap UVs into one wave field per surface.
 * userData.bookReflectionSurface.setStrength(0) provides a uniform-only A/B;
 * it does not rebuild materials, programs, textures, geometry or shadows. */
export function applyBookReflectionSurface(material, { seed = '', strength = .018, uvScale = [1, 1] } = {}) {
  if (!material?.isMeshStandardMaterial) return material;
  const existing = installed.get(material);
  if (existing) {
    existing.setSeed(seed); existing.setStrength(strength); existing.setUvScale(uvScale);
    return material;
  }

  let profile = reflectionProfile(seed), slope = 0;
  const uniforms = { bookReflectionPhase:{ value:profile.phase }, bookReflectionStrength:{ value:0 },
    bookReflectionUvScale:{ value:new Vector2(1, 1) } };
  const controls = {
    uniforms,
    setStrength(value) {
      const number = Number(value);
      slope = Number.isFinite(number) ? Math.min(.05, Math.max(0, number)) : 0;
      uniforms.bookReflectionStrength.value = slope * profile.amplitude;
    },
    setSeed(value) {
      profile = reflectionProfile(value);
      uniforms.bookReflectionPhase.value.copy(profile.phase);
      uniforms.bookReflectionStrength.value = slope * profile.amplitude;
    },
    setUvScale(value) {
      const x = Number(value?.[0] ?? value?.x), y = Number(value?.[1] ?? value?.y);
      uniforms.bookReflectionUvScale.value.set(Number.isFinite(x) && x > 0 ? x : 1,
        Number.isFinite(y) && y > 0 ? y : 1);
    }
  };
  controls.setStrength(strength);
  controls.setUvScale(uvScale);
  installed.set(material, controls);
  material.userData.bookReflectionSurface = controls;

  const beforeCompile = material.onBeforeCompile;
  // Capture the prior key before replacing onBeforeCompile: Three's default
  // cache key is the hook's source. Book phases/strength are only uniforms,
  // so hundreds of books still share a shader program for a material variant.
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    beforeCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vBookReflectionUv;\nuniform vec2 bookReflectionUvScale;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vBookReflectionUv = uv * bookReflectionUvScale;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', declarations + physicalPars)
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n' + normalSetup)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + anisotropySetup)
      .replace('#include <lights_fragment_maps>', environmentMaps);
  };
  material.customProgramCacheKey = () => `${previousKey}|${CACHE_KEY}`;
  material.needsUpdate = true;
  return material;
}
