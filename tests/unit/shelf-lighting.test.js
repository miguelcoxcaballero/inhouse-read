import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShelfLighting } from '../../src/js/shelf-lighting.js';

describe('visible shelf lighting', () => {
  it('fits a single bounded soft shadow to the visible rows and stays quiet at rest', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    scene.userData.readerLight = key; scene.add(key);
    const renderer = { shadowMap:{ needsUpdate:false } };
    const lighting = createShelfLighting(scene, renderer);
    const frame = { width:390, viewportHeight:700, scroll:0, depth:160, dirty:true };
    lighting.update(frame);
    expect(key.castShadow).toBe(true);
    expect(key.shadow.mapSize.toArray()).toEqual([1024,1024]);
    expect(key.shadow.autoUpdate).toBe(false);
    expect(key.shadow.camera.top).toBeLessThan(1000);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    renderer.shadowMap.needsUpdate = false; key.shadow.needsUpdate = false;
    lighting.update({ ...frame, dirty:false });
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    expect(key.shadow.needsUpdate).toBe(false);
    const previousY = key.target.position.y;
    lighting.update({ ...frame, scroll:500, dirty:false });
    expect(key.target.position.y).toBe(previousY - 500);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    key.shadow.map = { dispose:vi.fn() };
    lighting.dispose();
    expect(key.shadow.map.dispose).toHaveBeenCalledTimes(1);
  });
});
