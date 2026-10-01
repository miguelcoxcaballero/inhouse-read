import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createBaggebo } from '../../src/js/baggebo-model.js';
import { BAGGEBO_SPEC } from '../../src/js/shelf-types.js';

describe('IKEA BAGGEBO model', () => {
  it('matches the published 600 × 250 × 1160 mm footprint and scene coordinate convention', () => {
    const shelf = createBaggebo();
    const bounds = new THREE.Box3().setFromObject(shelf);
    expect(bounds.min.toArray()).toEqual([-300, -1160, -250]);
    expect(bounds.max.x).toBe(300);
    expect(bounds.max.y).toBeCloseTo(0, 10);
    expect(bounds.max.z).toBe(0);
    expect(shelf.userData.furniture).toBe(true);
    expect(shelf.userData.physicalDimensions).toEqual({ width:600, depth:250, height:1160 });
    shelf.userData.dispose();
  });

  it('preserves proportions and book baselines when fitted to a narrower screen', () => {
    const shelf = createBaggebo({ width:300 });
    const bounds = new THREE.Box3().setFromObject(shelf);
    expect(bounds.getSize(new THREE.Vector3()).toArray()).toEqual([300, 580, 125]);
    expect(shelf.userData.physicalDimensions).toEqual({ width:300, depth:125, height:580 });
    expect(shelf.userData.shelfPositions.map(position => position.bottom)).toEqual([180, 341.25, 502.5]);
    expect(shelf.scale.toArray()).toEqual([.5, .5, .5]);
    shelf.userData.dispose();
  });

  it('builds the assembly manual’s three internal mesh shelves, mesh top, four uprights and rear brace', () => {
    const shelf = createBaggebo();
    const parts = shelf.userData.parts;
    expect(parts.filter(part => part.kind === 'upright')).toHaveLength(4);
    expect(parts.filter(part => part.kind === 'foot')).toHaveLength(4);
    expect(parts.filter(part => part.kind === 'mesh-top')).toHaveLength(1);
    const surfaces = parts.filter(part => part.kind === 'mesh-shelf');
    expect(surfaces).toHaveLength(3);
    surfaces.forEach((part, index) => {
      expect(part.bounds.max.y).toBeCloseTo(-BAGGEBO_SPEC.shelfBottoms[index], 5);
      expect(part.bounds.getSize(new THREE.Vector3()).z).toBe(220);
    });
    const brace = parts.find(part => part.kind === 'mesh-brace');
    expect(brace.bounds.getSize(new THREE.Vector3()).x).toBe(216);
    expect(brace.bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(320, 4);
    expect(brace.bounds.max.y).toBeCloseTo(-376.51, 4);
    expect(parts.filter(part => part.kind === 'screw').length).toBeGreaterThan(20);
    expect(parts.some(part => part.name.includes('back-backer'))).toBe(false);
    shelf.userData.dispose();
  });

  it('keeps actual mesh apertures open for raycasting and both shadow passes', () => {
    const shelf = createBaggebo();
    shelf.updateMatrixWorld(true);
    const mesh = shelf.children.find(child => child.material.alphaMap);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, -528, 20), new THREE.Vector3(0, 0, -1));
    // This ray crosses the centre of an aperture in the central back panel.
    expect(raycaster.intersectObject(mesh)).toHaveLength(0);
    raycaster.ray.origin.x = 3.6;
    // At the same elevation, this point is a metal strand, not an aperture.
    expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
    expect(mesh.customDepthMaterial.alphaMap).toBe(mesh.material.alphaMap);
    expect(mesh.customDistanceMaterial.alphaMap).toBe(mesh.material.alphaMap);
    expect(mesh.customDepthMaterial.alphaTest).toBe(mesh.material.alphaTest);
    expect(mesh.customDistanceMaterial.alphaTest).toBe(mesh.material.alphaTest);
    expect(mesh.material.side).toBe(THREE.DoubleSide);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    const data = mesh.material.alphaMap.image.data;
    expect(data.some((value, index) => index % 4 === 1 && value === 0)).toBe(true);
    expect(data.some((value, index) => index % 4 === 1 && value === 255)).toBe(true);
    shelf.userData.dispose();
  });

  it('batches all parts into four draw calls and keeps geometry finite for mobile rendering', () => {
    const shelf = createBaggebo();
    expect(shelf.children).toHaveLength(4);
    const triangles = shelf.children.reduce((total, mesh) => total + mesh.geometry.attributes.position.count / 3, 0);
    expect(triangles).toBeLessThan(12000);
    for (const mesh of shelf.children) {
      expect(mesh.castShadow).toBe(true);
      expect([...mesh.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
      expect([...mesh.geometry.attributes.normal.array].every(Number.isFinite)).toBe(true);
      expect([...mesh.geometry.attributes.uv.array].every(Number.isFinite)).toBe(true);
    }
    const painted = shelf.children.find(mesh => mesh.material.name.includes('powder-coated'));
    expect(painted.material.roughness).toBeGreaterThan(.3);
    expect(painted.material.metalness).toBeLessThan(.2);
    shelf.userData.dispose();
  });

  it('disposes all owned resources once without invalidating a second model’s textures', () => {
    const first = createBaggebo(), second = createBaggebo();
    const resources = new Set();
    for (const mesh of first.children) {
      resources.add(mesh.geometry); resources.add(mesh.material);
      if (mesh.material.alphaMap) resources.add(mesh.material.alphaMap);
      if (mesh.material.bumpMap) resources.add(mesh.material.bumpMap);
      if (mesh.customDepthMaterial) resources.add(mesh.customDepthMaterial);
      if (mesh.customDistanceMaterial) resources.add(mesh.customDistanceMaterial);
    }
    let disposals = 0, secondDisposals = 0;
    for (const resource of resources) resource.addEventListener('dispose', () => { disposals += 1; });
    const firstMask = first.children.find(mesh => mesh.material.alphaMap).material.alphaMap;
    const secondMask = second.children.find(mesh => mesh.material.alphaMap).material.alphaMap;
    expect(firstMask).not.toBe(secondMask);
    secondMask.addEventListener('dispose', () => { secondDisposals += 1; });
    first.userData.dispose(); first.userData.disposeGeometry();
    expect(disposals).toBe(resources.size);
    expect(secondDisposals).toBe(0);
    second.userData.dispose();
    expect(secondDisposals).toBe(1);
  });
});
