import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { compilePrograms } from '../../src/js/gpu-programs.js';

// Submission and completion are separate: flush queues work without finishing
// a link, drawing a frame, reflecting uniforms or changing the render target.
function driver() {
  let target = null;
  const events = [], programs = [], byMaterial = new Map();
  const gl = {
    flush: vi.fn(() => {
      events.push({ kind: 'flush', target });
      for (const program of programs) program.submitted = true;
    }),
    finish: vi.fn(),
  };
  const renderer = {
    getContext: vi.fn(() => gl),
    getRenderTarget: () => target,
    setRenderTarget: next => { target = next; },
    render: vi.fn(),
    properties: { get: material => ({ programs: byMaterial.get(material) }) },
    compile: vi.fn(listing => {
      const materials = new Set();
      listing.traverse(object => {
        for (const material of [].concat(object.material)) materials.add(material);
      });
      events.push({ kind: 'compile', target, materials });
      for (const material of materials) {
        const program = {
          submitted: false, finished: false,
          isReady() { return this.submitted && this.finished; },
        };
        if (!byMaterial.has(material)) byMaterial.set(material, new Map());
        byMaterial.get(material).set(target, program);
        programs.push(program);
      }
      return materials;
    }),
  };
  return { renderer, gl, programs, events };
}
const mesh = material => new THREE.Mesh(new THREE.BufferGeometry(), material);
const camera = () => new THREE.PerspectiveCamera();

describe('submission of the complete shader batch', () => {
  it('submits pending links once without waiting or drawing', () => {
    const { renderer, gl, programs } = driver(), scene = new THREE.Scene();
    scene.add(mesh(new THREE.MeshStandardMaterial()));
    const ready = compilePrograms(renderer, scene, camera());
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(programs.every(program => program.submitted)).toBe(true);
    expect(ready()).toBe(false);
    expect(gl.finish).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
    programs.forEach(program => { program.finished = true; });
    expect(ready()).toBe(true);
  });

  it('submits screen and linear glass variants after restoring the original target', () => {
    const { renderer, gl, programs, events } = driver(), scene = new THREE.Scene();
    const previous = new THREE.WebGLRenderTarget(2, 2);
    renderer.setRenderTarget(previous);
    scene.add(mesh(new THREE.MeshStandardMaterial()), mesh(new THREE.MeshPhysicalMaterial({ transmission: .9 })));
    const ready = compilePrograms(renderer, scene, camera());
    expect(events.map(event => event.kind)).toEqual(['compile', 'compile', 'flush']);
    expect(events[2].target).toBe(previous);
    expect(renderer.getRenderTarget()).toBe(previous);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(programs).toHaveLength(3);
    programs.slice(0, 2).forEach(program => { program.finished = true; });
    expect(ready()).toBe(false);
    programs[2].finished = true;
    expect(ready()).toBe(true);
    previous.dispose();
  });

  it('does not resubmit or compile on readiness polls', () => {
    const { renderer, gl } = driver(), scene = new THREE.Scene();
    scene.add(mesh(new THREE.MeshStandardMaterial()));
    const ready = compilePrograms(renderer, scene, camera());
    for (let i = 0; i < 5; i++) expect(ready()).toBe(false);
    expect(renderer.compile).toHaveBeenCalledOnce();
    expect(gl.flush).toHaveBeenCalledOnce();
  });

  it('leaves a renderer without compile on its original ready path', () => {
    const renderer = { getContext: vi.fn() };
    expect(compilePrograms(renderer, new THREE.Scene(), camera())()).toBe(true);
    expect(renderer.getContext).not.toHaveBeenCalled();
  });

  it('does not submit an empty batch', () => {
    const { renderer, gl } = driver();
    expect(compilePrograms(renderer, new THREE.Scene(), camera())()).toBe(true);
    expect(gl.flush).not.toHaveBeenCalled();
    expect(renderer.getContext).not.toHaveBeenCalled();
  });

  it('submits an explicitly prepared hidden mesh without making it visible', () => {
    const { renderer, gl, events, programs } = driver(), scene = new THREE.Scene();
    const group = new THREE.Group(), hidden = mesh(new THREE.MeshBasicMaterial());
    group.visible = false; group.add(hidden); scene.add(group);
    const ready = compilePrograms(renderer, scene, camera(), [hidden]);
    expect(events[0].materials).toEqual(new Set([hidden.material]));
    expect(group.visible).toBe(false);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(ready()).toBe(false);
    programs[0].finished = true;
    expect(ready()).toBe(true);
  });
});
