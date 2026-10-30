// Frozen copy of the shader hooks of src/js/book-model.js (spineGrazingFade and installCoverRelief) before their
// text moved to Rust (rust-ui/src/book_shaders.rs), verbatim. The differential test compares the programs.
import * as THREE from 'three';
import { METAL_COLORS, SURFACE_FINISHES, spineFinish, surfaceFinish } from '../../../src/js/book-colors.js';

// Seen almost edge-on (the lifted book's front view), spine lettering shrinks
// into bright slivers along the rolled edge. Only while the spine as a whole
// faces away, the surface that turns from the viewer shows plain cloth; the
// rules near the joint, which still face the viewer, keep their ink.
export function referenceSpineGrazingFade(material) {
  const uniforms = { spineCloth:{ value:new THREE.Color() }, spineClothMetal:{ value:0 }, spineClothRough:{ value:.88 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying float vSpineFacing;\nvoid main() {')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\n\tvSpineFacing = abs(normalize((modelViewMatrix * vec4(-1., 0., 0., 0.)).xyz).z);');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {',
      'varying float vSpineFacing;\nuniform vec3 spineCloth;\nuniform float spineClothMetal, spineClothRough;\nvoid main() {')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	float spineEdge = .62 * (1. - smoothstep(.35, .6, vSpineFacing));
	float spineKeep = smoothstep(spineEdge - .16, spineEdge,
		abs(dot(nonPerturbedNormal, isOrthographic ? vec3(0., 0., 1.) : normalize(vViewPosition))));
	diffuseColor.rgb = mix(spineCloth, diffuseColor.rgb, spineKeep);
	metalnessFactor = mix(spineClothMetal, metalnessFactor, spineKeep);
	roughnessFactor = mix(spineClothRough, roughnessFactor, spineKeep);
	normal = normalize(mix(nonPerturbedNormal, normal, spineKeep));`);
  };
  material.customProgramCacheKey = () => 'spine-grazing-fade';
  return (book, style) => {
    const finish = spineFinish(book.spineFinish);
    uniforms.spineCloth.value.set(finish === 'matte' ? style.color : METAL_COLORS[finish]);
    uniforms.spineClothMetal.value = finish === 'matte' ? 0 : 1;
    uniforms.spineClothRough.value = SURFACE_FINISHES[surfaceFinish(book.spineSurfaceFinish, 'matte')].roughness;
  };
}

/** Relief reaches the shader through the clearcoat normal map. The same
 * tangent-space normal also bends the base layer's normal, so the raised
 * zones read under a matte, satin or glossy laminate alike. Neutral
 * placeholder maps leave every pixel unchanged. */
export function referenceInstallCoverRelief(material) {
  const previousHook = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  const uniforms = {
    bookReliefBaseFinish:{ value:new THREE.Vector3() },
    bookReliefStrength:{ value:0 }
  };
  const physical = THREE.ShaderChunk.lights_physical_fragment
    .replace('material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;',
      'material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).a;')
    .replace('PhysicalMaterial material;', `roughnessFactor = mix( bookReliefBaseFinish.y, roughnessFactor, bookReliefAmount );
PhysicalMaterial material;`)
    .replace('material.clearcoat = saturate( material.clearcoat );', `material.clearcoat = mix( bookReliefBaseFinish.x, material.clearcoat, bookReliefAmount );
  material.clearcoatRoughness = mix( bookReliefBaseFinish.z, material.clearcoatRoughness, bookReliefAmount );
  material.clearcoat = saturate( material.clearcoat );`);
  material.onBeforeCompile = function(shader, renderer) {
    previousHook.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec3 bookReliefBaseFinish;
uniform float bookReliefStrength;
float bookReliefAmount = 0.0;
void main() {`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	#ifdef USE_CLEARCOAT_NORMALMAP
		vec4 reliefSample = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv );
		bookReliefAmount = step( 0.5 / 255.0, reliefSample.a ) * bookReliefStrength;
		vec3 reliefN = vec3( ( reliefSample.xy * 255.0 - 128.0 ) / 127.0, reliefSample.z * 2.0 - 1.0 );
		reliefN.xy *= clearcoatNormalScale;
		reliefN.z = mix( 1.0, reliefN.z, bookReliefStrength );
		normal = normalize( normal + tbn2 * reliefN - tbn2[ 2 ] );
	#endif`)
      .replace('#include <clearcoat_normal_fragment_maps>', THREE.ShaderChunk.clearcoat_normal_fragment_maps
        .replace('texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0',
          'vec3( ( reliefSample.xy * 255.0 - 128.0 ) / 127.0, reliefSample.z * 2.0 - 1.0 )'))
      .replace('#include <lights_physical_fragment>', physical);
  };
  material.customProgramCacheKey = () => `${previousKey}|cover-relief-color-v2`;
  return uniforms;
}
