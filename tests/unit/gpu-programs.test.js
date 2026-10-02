import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { compilePrograms, keepProgramsAlive, retainPrograms } from '../../src/js/gpu-programs.js';

const program = (ready = true) => ({ usedTimes:1, ready, isReady() { return this.ready; } });

// A renderer double that records what three would be asked to compile and
// which render target was bound while it happened.
function fakeRenderer(programsByMaterial = new Map()) {
  const calls = [];
  let target = null;
  return {
    calls,
    info:{ programs:[] },
    properties:{ get:material => ({ programs:programsByMaterial.get(material) }) },
    getRenderTarget:() => target,
    setRenderTarget(next) { target = next; },
    compile(listing, camera, scene) {
      const meshes = [];
      listing.traverse(object => meshes.push(object));
      calls.push({ meshes, target, scene });
      return new Set(meshes.map(mesh => mesh.material));
    }
  };
}
const mesh = (material, visible = true) => Object.assign(new THREE.Mesh(new THREE.BufferGeometry(), material), { visible });

describe('program retention', () => {
  it('pins each program once so disposing its last material cannot delete it', () => {
    const renderer = fakeRenderer(), first = program(), second = program();
    renderer.info.programs.push(first);
    retainPrograms(renderer);
    retainPrograms(renderer);
    expect(first.usedTimes).toBe(2);
    renderer.info.programs.push(second);
    retainPrograms(renderer);
    expect([first.usedTimes, second.usedTimes]).toEqual([2, 2]);
  });

  it('pins whatever a render created, keeping render arguments and result untouched', () => {
    const renderer = fakeRenderer(), created = program(), seen = [];
    renderer.render = function (scene, camera) { seen.push([this, scene, camera]); renderer.info.programs.push(created); };
    keepProgramsAlive(renderer);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    renderer.render(scene, camera);
    expect(seen).toEqual([[renderer, scene, camera]]);
    expect(created.usedTimes).toBe(2);
  });
});

describe('compilePrograms', () => {
  it('hands three only the objects the next frame can draw', () => {
    const scene = new THREE.Scene(), shown = mesh(new THREE.MeshStandardMaterial());
    const hidden = mesh(new THREE.MeshStandardMaterial(), false), group = new THREE.Group();
    group.visible = false; group.add(mesh(new THREE.MeshStandardMaterial()));
    scene.add(shown, hidden, group, new THREE.DirectionalLight());
    const renderer = fakeRenderer();
    compilePrograms(renderer, scene, new THREE.PerspectiveCamera());
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0].meshes).toEqual([shown]);
    expect(renderer.calls[0].scene).toBe(scene);
    expect(renderer.calls[0].target).toBe(null);
  });

  it('reports ready only when every linked program has finished', () => {
    const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
    const slow = program(false), fast = program(true);
    scene.add(mesh(material));
    const ready = compilePrograms(fakeRenderer(new Map([[material, new Map([['a', slow], ['b', fast]])]])), scene, new THREE.PerspectiveCamera());
    expect(ready()).toBe(false);
    slow.ready = true;
    expect(ready()).toBe(true);
  });

  it('stops waiting for a driver that never reports completion', () => {
    const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
    scene.add(mesh(material));
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const ready = compilePrograms(fakeRenderer(new Map([[material, new Map([['a', program(false)]])]])), scene, new THREE.PerspectiveCamera());
    expect(ready()).toBe(false);
    now.mockReturnValue(1000 + 15001);
    expect(ready()).toBe(true);
    now.mockRestore();
  });

  it('also links the linear half-float variant of the opaque meshes when glass forces a transmission pass', () => {
    const scene = new THREE.Scene();
    const opaque = mesh(new THREE.MeshStandardMaterial()), glass = mesh(new THREE.MeshPhysicalMaterial({ transmission:.9 }));
    const veil = mesh(new THREE.MeshBasicMaterial({ transparent:true }));
    scene.add(opaque, glass, veil);
    const renderer = fakeRenderer(), outside = new THREE.WebGLRenderTarget(2, 2);
    renderer.setRenderTarget(outside);
    compilePrograms(renderer, scene, new THREE.PerspectiveCamera());
    expect(renderer.calls).toHaveLength(2);
    expect(renderer.calls[0].meshes).toEqual([opaque, glass, veil]);
    expect(renderer.calls[0].target).toBe(outside);
    expect(renderer.calls[1].meshes).toEqual([opaque]);
    expect(renderer.calls[1].target).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(renderer.calls[1].target.texture.type).toBe(THREE.HalfFloatType);
    expect(renderer.getRenderTarget()).toBe(outside);
  });

  it('restores the render target even when compiling throws', () => {
    const scene = new THREE.Scene();
    scene.add(mesh(new THREE.MeshPhysicalMaterial({ transmission:.9 })));
    const renderer = fakeRenderer();
    let calls = 0;
    const compile = renderer.compile;
    renderer.compile = (...args) => { if (++calls === 2) throw new Error('lost'); return compile(...args); };
    expect(() => compilePrograms(renderer, scene, new THREE.PerspectiveCamera())).toThrow('lost');
    expect(renderer.getRenderTarget()).toBe(null);
  });

  it('skips the extra variant for a scene without glass', () => {
    const scene = new THREE.Scene();
    scene.add(mesh(new THREE.MeshStandardMaterial()), mesh(new THREE.MeshBasicMaterial({ transparent:true })));
    const renderer = fakeRenderer();
    compilePrograms(renderer, scene, new THREE.PerspectiveCamera());
    expect(renderer.calls).toHaveLength(1);
  });

  it('falls back to linking on first draw when the renderer cannot precompile', () => {
    expect(compilePrograms({}, new THREE.Scene(), new THREE.PerspectiveCamera())()).toBe(true);
  });
});
