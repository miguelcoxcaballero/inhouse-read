import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { compilePrograms, keepProgramsAlive, prelinkPrograms, retainPrograms, prepareProgramUniforms } from '../../src/js/gpu-programs.js';

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

describe('idle uniform reflection for hidden opening faces', () => {
  const setup = (...programs) => {
    const material = new THREE.MeshBasicMaterial();
    const renderer = fakeRenderer(new Map([[material, new Map(programs.map((p, i) => [i, p]))]]));
    return { renderer, materials:new Set([material]) };
  };
  it('reflects each exact program after a separate idle slice, without drawing or compiling again', async () => {
    const events = [], first = { ...program(), getUniforms:vi.fn(() => events.push('first')) };
    const second = { ...program(), getUniforms:vi.fn(() => events.push('second')) };
    const { renderer, materials } = setup(first, second);
    const idle = vi.fn(async () => { events.push('idle'); });
    expect(await prepareProgramUniforms(renderer, materials, { idle })).toBe(true);
    expect(events).toEqual(['idle', 'first', 'idle', 'second']);
    expect(renderer.calls).toEqual([]);
    expect(await prepareProgramUniforms(renderer, materials, { idle })).toBe(true);
    expect(idle).toHaveBeenCalledTimes(2);
    expect(first.getUniforms).toHaveBeenCalledOnce();
    expect(second.getUniforms).toHaveBeenCalledOnce();
  });
  it('waits for the driver without querying uniforms while linking', async () => {
    const pending = { ...program(false), getUniforms:vi.fn() }, { renderer, materials } = setup(pending);
    const idle = vi.fn(async () => { expect(pending.getUniforms).not.toHaveBeenCalled(); if (idle.mock.calls.length === 3) pending.ready = true; });
    expect(await prepareProgramUniforms(renderer, materials, { idle })).toBe(true);
    expect(idle).toHaveBeenCalledTimes(3);
    expect(pending.getUniforms).toHaveBeenCalledOnce();
  });
  it('does not reflect a disposed or superseded page after yielding', async () => {
    const p = { ...program(), getUniforms:vi.fn() }, { renderer, materials } = setup(p);
    let active = true;
    expect(await prepareProgramUniforms(renderer, materials, { idle:async () => { active = false; }, current:() => active })).toBe(false);
    expect(p.getUniforms).not.toHaveBeenCalled();
  });
  it('leaves a driver that never becomes ready to the original first draw', async () => {
    const p = { ...program(false), getUniforms:vi.fn() }, { renderer, materials } = setup(p);
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      expect(await prepareProgramUniforms(renderer, materials, { idle:async () => { now += 8000; } })).toBe(false);
      expect(p.getUniforms).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it('does not cache a failed reflection and allows its original recovery', async () => {
    const p = { ...program(), getUniforms:vi.fn().mockImplementationOnce(() => { throw Error('Lost context'); }).mockReturnValue({}) };
    const { renderer, materials } = setup(p), options = { idle:async () => {} };
    await expect(prepareProgramUniforms(renderer, materials, options)).rejects.toThrow('Lost context');
    expect(await prepareProgramUniforms(renderer, materials, options)).toBe(true);
    expect(p.getUniforms).toHaveBeenCalledTimes(2);
  });
  it('keeps older renderer doubles and unavailable preparation on the original draw path', async () => {
    const { renderer, materials } = setup(program());
    expect(await prepareProgramUniforms(renderer, materials, { idle:async () => {} })).toBe(true);
    expect(await prepareProgramUniforms(renderer, materials)).toBe(false);
    expect(await prepareProgramUniforms({}, materials, { idle:async () => {} })).toBe(false);
    expect(renderer.calls).toEqual([]);
  });
});

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

  it('prepares an explicitly supplied hidden interaction without making it visible or linking it twice', () => {
    const scene = new THREE.Scene(), shown = mesh(new THREE.MeshStandardMaterial());
    const group = new THREE.Group(); group.visible = false;
    const guide = mesh(new THREE.MeshBasicMaterial({ transparent:true })); group.add(guide); scene.add(shown, group);
    const linking = program(false);
    const renderer = fakeRenderer(new Map([[guide.material, new Map([['guide', linking]])]]));
    const ready = compilePrograms(renderer, scene, new THREE.PerspectiveCamera(), [guide, guide]);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0].meshes).toEqual([shown, guide]);
    expect(group.visible).toBe(false);
    expect(ready()).toBe(false);
    linking.ready = true;
    expect(ready()).toBe(true);
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

describe('prelinkPrograms', () => {
  it('starts linking the visible meshes of each part against the whole scene, then hands them to the driver', () => {
    const scene = new THREE.Scene(), part = new THREE.Group(), shown = mesh(new THREE.MeshStandardMaterial());
    const hidden = mesh(new THREE.MeshStandardMaterial(), false), elsewhere = mesh(new THREE.MeshStandardMaterial());
    part.add(shown, hidden); scene.add(part, elsewhere, new THREE.DirectionalLight());
    const renderer = fakeRenderer(), flush = vi.fn();
    renderer.getContext = () => ({ flush });
    prelinkPrograms(renderer, scene, new THREE.PerspectiveCamera(), [part]);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0].meshes).toEqual([shown]);
    expect(renderer.calls[0].scene).toBe(scene);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('links nothing for an invisible part, or while another render target is bound', () => {
    const scene = new THREE.Scene(), part = new THREE.Group();
    part.add(mesh(new THREE.MeshStandardMaterial())); scene.add(part);
    const renderer = fakeRenderer(), camera = new THREE.PerspectiveCamera();
    part.visible = false;
    prelinkPrograms(renderer, scene, camera, [part]);
    part.visible = true;
    renderer.setRenderTarget(new THREE.WebGLRenderTarget(2, 2));
    prelinkPrograms(renderer, scene, camera, [part]);
    expect(renderer.calls).toHaveLength(0);
    expect(() => prelinkPrograms({}, scene, camera, [part])).not.toThrow();
  });
});
