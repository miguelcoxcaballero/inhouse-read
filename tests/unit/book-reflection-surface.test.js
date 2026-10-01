import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyBookReflectionSurface } from '../../src/js/book-reflection-surface.js';

function compile(material) {
  const shader = { vertexShader:THREE.ShaderLib.physical.vertexShader,
    fragmentShader:THREE.ShaderLib.physical.fragmentShader, uniforms:{} };
  material.onBeforeCompile(shader, {});
  return shader;
}

describe('specular-only book board imperfection', () => {
  it('supports cover laminates and standard cloth, excluding paper/basic materials chosen by the caller', () => {
    for (const material of [new THREE.MeshPhysicalMaterial(), new THREE.MeshStandardMaterial()]) {
      expect(applyBookReflectionSurface(material)).toBe(material);
      expect(material.userData.bookReflectionSurface).toBeDefined();
      const shader = compile(material);
      expect(shader.vertexShader).toContain('vBookReflectionUv = uv * bookReflectionUvScale;');
      expect(shader.fragmentShader).toContain('bookReflectionNormal = normalize(normal - bookReflectionTilt);');
    }
    const pageImage = new THREE.MeshBasicMaterial(), originalHook = pageImage.onBeforeCompile;
    expect(applyBookReflectionSurface(pageImage)).toBe(pageImage);
    expect(pageImage.onBeforeCompile).toBe(originalHook);
    expect(pageImage.userData.bookReflectionSurface).toBeUndefined();
  });

  it('keeps one book shape stable across levels of detail and distinct from another book', () => {
    const create = seed => {
      const material = new THREE.MeshPhysicalMaterial();
      applyBookReflectionSurface(material, { seed });
      return material.userData.bookReflectionSurface.uniforms;
    };
    const shelf = create('book:stable-id:front'), lifted = create('book:stable-id:front'), another = create('book:other-id:front');
    expect(shelf.bookReflectionPhase.value.toArray()).toEqual(lifted.bookReflectionPhase.value.toArray());
    expect(shelf.bookReflectionStrength.value).toBe(lifted.bookReflectionStrength.value);
    expect(shelf.bookReflectionPhase.value.toArray()).not.toEqual(another.bookReflectionPhase.value.toArray());
    expect(shelf.bookReflectionStrength.value).toBeGreaterThanOrEqual(.018 * .88);
    expect(shelf.bookReflectionStrength.value).toBeLessThanOrEqual(.018 * 1.12);
  });

  it('shares the shader cache key across books, phases, surface sizes and strengths', () => {
    const materials = ['one', 'two', 38].map((seed, i) => applyBookReflectionSurface(new THREE.MeshPhysicalMaterial(),
      { seed, strength:i * .015, uvScale:[1 / (i + 1), 1 / (i + 2)] }));
    expect(new Set(materials.map(material => material.customProgramCacheKey())).size).toBe(1);
    const shaders = materials.map(compile);
    expect(new Set(shaders.map(shader => shader.fragmentShader)).size).toBe(1);
    expect(new Set(shaders.map(shader => shader.vertexShader)).size).toBe(1);
  });

  it('composes an existing spine-grazing hook and preserves its cache distinction', () => {
    const material = new THREE.MeshPhysicalMaterial();
    const before = vi.fn(function(shader, renderer) {
      expect(this).toBe(material); expect(renderer).toEqual({});
      shader.uniforms.spineCloth = { value:'cloth' };
      shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying float vSpineFacing;\nvoid main() {');
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n normal = normalize(mix(nonPerturbedNormal, normal, .5));');
    });
    material.onBeforeCompile = before;
    material.customProgramCacheKey = () => 'spine-grazing-fade';
    applyBookReflectionSurface(material, { seed:'spine' });
    const shader = compile(material);
    expect(before).toHaveBeenCalledTimes(1);
    expect(shader.uniforms.spineCloth.value).toBe('cloth');
    expect(shader.vertexShader).toContain('varying float vSpineFacing;');
    expect(shader.fragmentShader.indexOf('normal = normalize(mix(nonPerturbedNormal, normal, .5));'))
      .toBeLessThan(shader.fragmentShader.indexOf('bookReflectionNormal = normalize(normal - bookReflectionTilt);'));
    expect(material.customProgramCacheKey()).toBe('spine-grazing-fade|book-reflection-surface-v1');
  });

  it('allows a zero-strength A/B entirely through uniforms without resource or program changes', () => {
    const texture = new THREE.Texture(), material = new THREE.MeshPhysicalMaterial({ map:texture, roughness:.19, clearcoat:1 });
    applyBookReflectionSurface(material, { seed:'test-cover', strength:.018 });
    const shader = compile(material), version = material.version, key = material.customProgramCacheKey();
    const hook = material.onBeforeCompile, originalSource = shader.fragmentShader;
    const controls = material.userData.bookReflectionSurface;
    controls.setStrength(0);
    expect(shader.uniforms.bookReflectionStrength.value).toBe(0);
    expect(material.version).toBe(version); expect(material.customProgramCacheKey()).toBe(key);
    expect(material.onBeforeCompile).toBe(hook); expect(shader.fragmentShader).toBe(originalSource);
    expect(material.map).toBe(texture); expect(material.roughness).toBe(.19); expect(material.clearcoat).toBe(1);
    controls.setStrength(.018);
    expect(shader.uniforms.bookReflectionStrength.value).toBeGreaterThan(0);
  });

  it('bounds the slope and safely handles invalid strengths and degenerate UV gradients', () => {
    const material = applyBookReflectionSurface(new THREE.MeshPhysicalMaterial(), { strength:Infinity });
    const controls = material.userData.bookReflectionSurface;
    for (const value of [-1, NaN, Infinity, 'nope']) {
      controls.setStrength(value); expect(controls.uniforms.bookReflectionStrength.value).toBe(0);
    }
    controls.setStrength(100);
    expect(controls.uniforms.bookReflectionStrength.value).toBeLessThanOrEqual(.05 * 1.12);
    const source = compile(material).fragmentShader;
    expect(source).toContain('inversesqrt(max(dot(bookT, bookT), 1e-20))');
    expect(source).toContain('inversesqrt(max(dot(bookB, bookB), 1e-20))');
  });

  it('normalizes cap geometry UVs by their physical size without recompiling', () => {
    const material = applyBookReflectionSurface(new THREE.MeshPhysicalMaterial(), { uvScale:[1 / 120, 1 / 24] });
    const shader = compile(material), version = material.version;
    expect(shader.uniforms.bookReflectionUvScale.value.toArray()).toEqual([1 / 120, 1 / 24]);
    material.userData.bookReflectionSurface.setUvScale(new THREE.Vector2(.02, .04));
    expect(shader.uniforms.bookReflectionUvScale.value.toArray()).toEqual([.02, .04]);
    material.userData.bookReflectionSurface.setUvScale([Infinity, -4]);
    expect(shader.uniforms.bookReflectionUvScale.value.toArray()).toEqual([1, 1]);
    expect(material.version).toBe(version);
  });

  it('updates an already installed profile without stacking shader hooks or cache suffixes', () => {
    const material = applyBookReflectionSurface(new THREE.MeshPhysicalMaterial(), { seed:'first' });
    const controls = material.userData.bookReflectionSurface, hook = material.onBeforeCompile, key = material.customProgramCacheKey();
    const shader = compile(material), oldPhase = shader.uniforms.bookReflectionPhase.value.toArray();
    applyBookReflectionSurface(material, { seed:'second', strength:.01, uvScale:[.1, .2] });
    expect(material.userData.bookReflectionSurface).toBe(controls);
    expect(material.onBeforeCompile).toBe(hook); expect(material.customProgramCacheKey()).toBe(key);
    expect(shader.uniforms.bookReflectionPhase.value.toArray()).not.toEqual(oldPhase);
    expect(shader.uniforms.bookReflectionUvScale.value.toArray()).toEqual([.1, .2]);
    expect(compile(material).fragmentShader.match(/vec3 bookReflectionNormal;/g)).toHaveLength(1);
  });

  it('leaves all diffuse irradiance, artwork, multiscattering energy and coat attenuation on the original normals', () => {
    const material = applyBookReflectionSurface(new THREE.MeshPhysicalMaterial());
    const source = compile(material).fragmentShader;
    expect(source).toContain('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );');
    expect(source).toContain('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );');
    expect(source).toContain('iblIrradiance += getIBLIrradiance( geometryNormal );');
    expect(source).toContain('computeMultiscattering( geometryNormal, geometryViewDir,');
    expect(source).toContain('reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;');
    expect(source).toContain('float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );');
    expect(source).toContain('lightColor * material.diffuseColor * LTC_Evaluate( geometryNormal,');
    expect(source).toContain('#include <map_fragment>');
    expect(source).toContain('#include <normal_fragment_maps>');
    expect(source).toContain('#include <lights_fragment_begin>');
    expect(source).toContain('#include <shadowmap_pars_fragment>');
  });

  it('uses the same perturbed normals for direct base/coat highlights and all environment reflection sampling', () => {
    const source = compile(applyBookReflectionSurface(new THREE.MeshPhysicalMaterial())).fragmentShader;
    expect(source).toContain('saturate(dot(bookReflectionNormal, directLight.direction)) * directLight.color;');
    expect(source).toContain('bookSpecularIrradiance * BRDF_GGX( directLight.direction, geometryViewDir, bookReflectionNormal, material );');
    expect(source).toContain('dot( bookReflectionClearcoatNormal, directLight.direction )');
    expect(source).toContain('BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, bookReflectionClearcoatNormal, material )');
    expect(source).toContain('getIBLRadiance( geometryViewDir, bookReflectionNormal, material.roughness )');
    expect(source).toContain('getIBLRadiance( geometryViewDir, bookReflectionClearcoatNormal, material.clearcoatRoughness )');
    expect(source).toContain('clearcoatRadiance * EnvironmentBRDF( bookReflectionClearcoatNormal,');
    expect(source).toContain('vec3 normal = bookReflectionNormal;');
  });

  it('reprojects foil grain once before the light loops and reuses that frame in direct and IBL reflection', () => {
    const source = compile(applyBookReflectionSurface(new THREE.MeshPhysicalMaterial({ anisotropy:.35 }))).fragmentShader;
    expect(source).toContain('bookReflectionAnisotropyT = normalize(material.anisotropyT - bookReflectionNormal *');
    expect(source).toContain('bookReflectionAnisotropyB = normalize(cross(bookReflectionNormal, bookReflectionAnisotropyT));');
    expect(source).toContain('dot( bookReflectionAnisotropyT, lightDir )');
    expect(source).toContain('dot( bookReflectionAnisotropyB, halfDir )');
    expect(source).toContain('getIBLAnisotropyRadiance( geometryViewDir, bookReflectionNormal, material.roughness, bookReflectionAnisotropyB, material.anisotropy )');
    expect(source.indexOf('bookReflectionAnisotropyT = normalize(')).toBeLessThan(source.indexOf('#include <lights_fragment_begin>'));
    expect(source.match(/bookReflectionAnisotropyT = normalize\(/g)).toHaveLength(1);
    expect(source.match(/vec3 bookWaveCos = cos\(/g)).toHaveLength(1);
  });

  it('adds no texture reads, position displacement or time-dependent effect', () => {
    const material = applyBookReflectionSurface(new THREE.MeshPhysicalMaterial());
    const shader = compile(material);
    expect(shader.vertexShader).toContain('#include <begin_vertex>');
    expect(shader.vertexShader).toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('#include <shadowmap_vertex>');
    expect(shader.vertexShader.match(/transformed\s*[+\-*]?=/g)).toBeNull();
    expect(Object.keys(shader.uniforms).sort()).toEqual(['bookReflectionPhase', 'bookReflectionStrength', 'bookReflectionUvScale']);
    // Shader-chunk expansion retains existing sampler reads; the wave field
    // itself is exactly one vec3 cosine with no custom texture or time source.
    const waveStart = shader.fragmentShader.indexOf('vec3 bookWaveAngle'), waveEnd = shader.fragmentShader.indexOf('#include <emissivemap_fragment>');
    expect(shader.fragmentShader.slice(waveStart, waveEnd)).not.toMatch(/texture\(|texture2D\(|sampler|time/i);
    expect(THREE.ShaderChunk.lights_physical_pars_fragment).toContain('irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );');
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )');
  });
});
