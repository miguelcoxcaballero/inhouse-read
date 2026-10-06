import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { prepareInsertionPrograms } from '../../src/js/insertion-program-preparation.js';

function fixture() {
  const material = new THREE.MeshBasicMaterial({ colorWrite:false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), material);
  const program = { isReady:() => true, getUniforms:vi.fn(() => ({})) };
  const properties = new WeakMap();
  const renderer = {
    compile:vi.fn(list => { list.traverse(object => {
      for (const value of Array.isArray(object.material) ? object.material : [object.material])
        properties.set(value, { programs:new Map([['depth', program]]) });
    }); }),
    getRenderTarget:() => null, getContext:() => ({ flush:vi.fn() }),
    properties:{ get:value => properties.get(value) || {} }, render:vi.fn()
  };
  return { renderer, mesh, material, program, scene:new THREE.Scene(), camera:new THREE.PerspectiveCamera() };
}
const run = (f, options, roots = [f.mesh]) => prepareInsertionPrograms(f.renderer, f.scene, f.camera, roots, options);

describe('deferred insertion programs', () => {
  it('waits for idle before linking and reflects before the first insertion draw', async () => {
    const f=fixture(); let release;
    const idle=vi.fn().mockImplementationOnce(() => new Promise(resolve => { release=resolve; })).mockResolvedValue();
    const task=run(f,{ idle,current:() => true });
    expect(f.renderer.compile).not.toHaveBeenCalled(); expect(f.program.getUniforms).not.toHaveBeenCalled();
    release(); expect(await task).toBe(true);
    expect(f.renderer.compile).toHaveBeenCalledTimes(1); expect(f.program.getUniforms).toHaveBeenCalledTimes(1);
    expect(idle).toHaveBeenCalledTimes(2); expect(f.renderer.render).not.toHaveBeenCalled();
  });
  it('deduplicates shared programs without changing models or materials', async () => {
    const f=fixture(), second=new THREE.Mesh(f.mesh.geometry, [f.material, f.material]);
    const before=f.mesh.geometry.attributes.position.array.slice();
    expect(await run(f,{ idle:async () => {}, current:() => true },[f.mesh,second])).toBe(true);
    expect(f.program.getUniforms).toHaveBeenCalledTimes(1);
    expect(f.mesh.geometry.attributes.position.array).toEqual(before); expect(f.material.colorWrite).toBe(false);
  });
  it('does no work when the owner is disposed before the first idle', async () => {
    const f=fixture(), onLinked=vi.fn();
    expect(await run(f,{ idle:async () => {},current:() => false,onLinked })).toBe(false);
    expect(f.renderer.compile).not.toHaveBeenCalled(); expect(onLinked).not.toHaveBeenCalled();
  });
  it('reports linked programs then cancels reflection when the owner disappears', async () => {
    const f=fixture(); let active=true; const onLinked=vi.fn(() => { active=false; });
    expect(await run(f,{ idle:async () => {},current:() => active,onLinked })).toBe(false);
    expect(onLinked).toHaveBeenCalledTimes(1); expect(f.program.getUniforms).not.toHaveBeenCalled();
  });
  it('propagates a failed reflection to the caller without drawing', async () => {
    const f=fixture(); f.program.getUniforms.mockImplementation(() => { throw new Error('Lost context'); });
    await expect(run(f,{ idle:async () => {},current:() => true })).rejects.toThrow('Lost context');
    expect(f.renderer.render).not.toHaveBeenCalled();
  });
  it('keeps the prelink contract for a renderer without uniform properties', async () => {
    const f=fixture(); delete f.renderer.properties; const onLinked=vi.fn();
    expect(await run(f,{ idle:async () => {},current:() => true,onLinked })).toBe(false);
    expect(f.renderer.compile).toHaveBeenCalledTimes(1); expect(onLinked).toHaveBeenCalledTimes(1);
    expect(f.renderer.render).not.toHaveBeenCalled();
  });
});
