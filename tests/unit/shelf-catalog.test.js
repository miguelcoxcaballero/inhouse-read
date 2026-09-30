import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShelfCatalog } from '../../src/js/shelf-catalog.js';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});
afterEach(() => vi.restoreAllMocks());

describe('paper catalogue clipped to the cabinet side', () => {
  it('has a real paper block, four leaves, two covers, a folded edge and metal clip', () => {
    const catalog = createShelfCatalog();
    expect(catalog.userData.catalog).toBe(true);
    expect(catalog.getObjectByName('catalog-paper-block').geometry.type).toBe('BoxGeometry');
    expect(catalog.children.filter(object => object.name.startsWith('catalog-sheet-'))).toHaveLength(4);
    expect(catalog.getObjectByName('catalog-front-cover').material.map.isCanvasTexture).toBe(true);
    expect(catalog.getObjectByName('catalog-front-cover').material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(catalog.getObjectByName('catalog-clip').material.metalness).toBeGreaterThan(.8);
    expect(catalog.children.length).toBeLessThanOrEqual(11);
    const box = new THREE.Box3().setFromObject(catalog);
    expect(box.max.z - box.min.z).toBeGreaterThan(4);
    expect(box.max.y - box.min.y).toBeGreaterThan(108);
    catalog.userData.dispose();
  });

  it('mounts with its cover facing out from the right wall and fits the declared pick envelope', () => {
    const catalog = createShelfCatalog({ width:76, height:108, thickness:3.4 });
    const front = catalog.getObjectByName('catalog-front-cover');
    catalog.rotation.y = Math.PI / 2; catalog.position.set(155 + 3, -120, -80);
    catalog.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(front.matrixWorld);
    expect(normal.x).toBeCloseTo(1);
    expect(normal.z).toBeCloseTo(0);
    const geometryBox = new THREE.Box3().setFromObject(catalog);
    const declared = catalog.userData.bounds.clone().applyMatrix4(catalog.matrixWorld);
    expect(declared.containsBox(geometryBox)).toBe(true);
    catalog.userData.dispose();
  });

  it('disposes its own geometries, paper texture and shared materials once', () => {
    const catalog = createShelfCatalog();
    const front = catalog.getObjectByName('catalog-front-cover'), leaf = catalog.getObjectByName('catalog-sheet-0');
    const geometry = vi.spyOn(front.geometry, 'dispose');
    const texture = vi.spyOn(front.material.map, 'dispose');
    const sharedPaper = vi.spyOn(leaf.material, 'dispose');
    catalog.userData.dispose(); catalog.userData.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(texture).toHaveBeenCalledTimes(1);
    expect(sharedPaper).toHaveBeenCalledTimes(1);
  });
});
