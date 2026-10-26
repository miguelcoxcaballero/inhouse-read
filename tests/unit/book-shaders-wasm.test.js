// The shader text of a book's materials (reflection layer, spine grazing fade, cover relief) comes from the shelf
// module (rust-ui/src/book_shaders.rs). Every program source a hook writes is compared, character for character,
// with the frozen JavaScript it replaced, on three's own sources and on altered ones (missing, repeated and
// `$`-bearing patterns, so the replacement rules of String.prototype.replace are exercised too), along each chain
// of hooks the models install, including the materials of real models.
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { applyBookReflectionSurface } from '../../src/js/book-reflection-surface.js';
import { applyBookReflectionSurface as referenceReflection } from './helpers/reference-book-reflection-surface.js';
import { referenceInstallCoverRelief, referenceSpineGrazingFade } from './helpers/reference-book-shaders.js';
import { createBookModel } from '../../src/js/book-model.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';

afterEach(() => vi.restoreAllMocks());

function sources() {
  const physical = THREE.ShaderLib.physical, standard = THREE.ShaderLib.standard;
  const list = [[physical.vertexShader, physical.fragmentShader], [standard.vertexShader, standard.fragmentShader]];
  const twice = (text, include) => text.replace(include, `${include}\n${include}`);
  const [vertex, fragment] = list[0];
  list.push(
    [twice(vertex, '#include <uv_vertex>'), twice(twice(fragment, '#include <lights_fragment_maps>'), '#include <normal_fragment_maps>')],
    [twice(vertex, 'void main() {'), twice(fragment, '#include <clearcoat_normal_fragment_maps>')],
    [vertex.replace('void main() {', 'void main(){'), fragment.replace('#include <lights_physical_pars_fragment>', '')],
    [`// $& $\` $' $$ $1\n${vertex}`, `// cost: $5 & $'\n${fragment}`],
    ['void main() { }', 'void main() { gl_FragColor = vec4(1.); }'],
    ['', '']);
  return list;
}
function compile(material, [vertexShader, fragmentShader]) {
  const shader = { vertexShader, fragmentShader, uniforms:{} };
  material.onBeforeCompile(shader, null);
  return shader;
}
function expectSamePrograms(actual, expected, label) {
  for (const [index, source] of sources().entries()) {
    const left = compile(actual, source), right = compile(expected, source);
    expect(left.vertexShader, `${label} vertex ${index}`).toBe(right.vertexShader);
    expect(left.fragmentShader, `${label} fragment ${index}`).toBe(right.fragmentShader);
    expect(Object.keys(left.uniforms), `${label} uniforms ${index}`).toEqual(Object.keys(right.uniforms));
  }
  expect(actual.customProgramCacheKey(), `${label} key`).toBe(expected.customProgramCacheKey());
}
function canvasContext() {
  const context = new Proxy({
    measureText: text => ({ width:String(text).length * 16 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, width, height) => ({ data:new Uint8ClampedArray(width * height * 4) })
  }, { get: (target, key) => target[key] ?? (() => {}) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
}

it('writes the reflection layer of every outer material exactly like the original', () => {
  for (const Material of [THREE.MeshStandardMaterial, THREE.MeshPhysicalMaterial]) {
    for (const options of [{}, { seed:'a|back', strength:.018 }, { seed:'a|tail', strength:.01, uvScale:[1 / 132, 1 / 30] },
      { seed:'a|cover', strength:.018, environmentReflection:.75 }]) {
      expectSamePrograms(applyBookReflectionSurface(new Material(), options), referenceReflection(new Material(), options), Material.name);
    }
  }
});

it('writes the spine fade and the cover relief of real models exactly like the original chains', () => {
  canvasContext();
  const style = { color:'#42604b', ink:'#fff', coverRatio:.66, width:30 };
  for (const options of [{}, { shelf:true }, { shelf:true, overview:true }, { shelf:true, inspectionResolution:1024 }]) {
    const model = createBookModel({ id:'shader', title:'Shader', coverRelief:null }, style, 132, 200, 30, null, options);
    const binding = model.getObjectByName('binding').material, front = model.getObjectByName('front-cover').material;
    const cover = Array.isArray(front) ? front[0] : front;
    // Lifted copies fade the spine first, then add the reflection layer; shelf copies only the layer.
    const referenceBinding = new THREE.MeshPhysicalMaterial();
    if (!options.shelf) referenceSpineGrazingFade(referenceBinding);
    referenceReflection(referenceBinding, { seed:'shader|binding', strength:.014 });
    expectSamePrograms(binding, referenceBinding, `binding ${JSON.stringify(options)}`);
    // Every cover carries the reflection layer and then the relief hook.
    const referenceCover = new THREE.MeshPhysicalMaterial();
    referenceReflection(referenceCover, { seed:'shader|cover', strength:.018, environmentReflection:.75 });
    referenceInstallCoverRelief(referenceCover);
    expectSamePrograms(cover, referenceCover, `cover ${JSON.stringify(options)}`);
    model.userData.dispose();
  }
});

it('gives a shelf of materials the same programs and keeps no module handles', () => {
  const rust = needRustShelf(), [vertexShader, fragmentShader] = sources()[0];
  const fresh = text => ` ${text}`.slice(1); // equal text in another string
  const before = rust.shelf_live_handles();
  const outputs = Array.from({ length:40 }, (_, i) => compile(applyBookReflectionSurface(new THREE.MeshStandardMaterial(),
    { seed:`book-${i}` }), [fresh(vertexShader), fresh(fragmentShader)]));
  expect(new Set(outputs.map(shader => shader.fragmentShader)).size).toBe(1);
  expect(new Set(outputs.map(shader => shader.vertexShader)).size).toBe(1);
  expect(outputs[0].fragmentShader).toBe(compile(referenceReflection(new THREE.MeshStandardMaterial()), [vertexShader, fragmentShader]).fragmentShader);
  expect(rust.shelf_live_handles()).toBe(before);
});
