import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createShelfTrash, sampleTrashDrop } from '../../src/js/shelf-trash.js';

describe('3D shelf wastebasket', () => {
  it('has a real open shell, inside base, raised rim and separate hinged lid', () => {
    const bin = createShelfTrash();
    expect(bin.userData.trash).toBe(true);
    const wall = bin.getObjectByName('Open metal body');
    expect(wall.geometry.type).toBe('LatheGeometry');
    const points = wall.geometry.parameters.points;
    expect(points.filter(point => point.y >= 84 && point.x < 27)).not.toHaveLength(0);
    expect(bin.getObjectByName('Dark interior base')).toBeTruthy();
    expect(bin.getObjectByName('Rolled metal lip')).toBeTruthy();
    expect(bin.getObjectByName('Solid lid').parent).toBe(bin.userData.lid);
    bin.userData.dispose();
  });

  it('opens the lid outward around its back axle without moving the body', () => {
    const bin = createShelfTrash();
    const wall = bin.getObjectByName('Open metal body');
    const before = wall.position.clone();
    bin.userData.setState({ openness:1 }); bin.updateMatrixWorld(true);
    const lid = bin.getObjectByName('Solid lid');
    const center = lid.getWorldPosition(new THREE.Vector3());
    expect(center.y).toBeGreaterThan(bin.userData.height + 20);
    expect(bin.userData.lid.rotation.x).toBeCloseTo(-Math.PI * .49);
    expect(wall.position.equals(before)).toBe(true);
    bin.userData.setState({ openness:0, bounce:1 });
    expect(bin.userData.lid.rotation.x).toBeCloseTo(0);
    expect(bin.userData.lid.rotation.z).toBe(0);
    bin.userData.dispose();
  });

  it('uses shared physical lighting and keeps its mesh budget small', () => {
    const bin = createShelfTrash();
    let meshes = 0, triangles = 0;
    bin.traverse(mesh => {
      if (!mesh.isMesh) return;
      meshes++;
      expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
      expect(mesh.material.isMeshStandardMaterial).toBe(true);
      triangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3;
      expect([...mesh.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    });
    expect(meshes).toBeLessThanOrEqual(10);
    expect(triangles).toBeLessThan(3500);
    bin.userData.dispose();
  });

  it('projects its actual open mouth through its world transform', () => {
    const bin = createShelfTrash();
    bin.position.set(310, -600, 24); bin.scale.setScalar(.75); bin.rotation.y = -.5;
    bin.updateMatrixWorld(true);
    const mouth = bin.userData.getMouth();
    expect(mouth.x).toBe(310); expect(mouth.z).toBe(24);
    expect(mouth.y).toBeCloseTo(-600 + (88 + 28 * .30) * .75);
    bin.userData.dispose();
  });

  it('flies above the rim and falls inside before completion', () => {
    const start = new THREE.Vector3(60, -120, 10), mouth = new THREE.Vector3(330, -480, 22);
    const initial = sampleTrashDrop(start, mouth, 0);
    expect(initial.position.equals(start)).toBe(true); expect(initial.scale).toBe(1);
    const above = sampleTrashDrop(start, mouth, .4);
    expect(above.position.y).toBeGreaterThan(start.clone().lerp(mouth, .65).y);
    const rim = sampleTrashDrop(start, mouth, .68);
    expect(rim.position.distanceTo(mouth)).toBeLessThan(1e-8);
    expect(sampleTrashDrop(start, mouth, .48).scale).toBeCloseTo(.19);
    const end = sampleTrashDrop(start, mouth, 1);
    expect(end.position.x).toBeCloseTo(mouth.x); expect(end.position.z).toBeCloseTo(mouth.z);
    expect(end.position.y).toBeLessThan(mouth.y - 50); expect(end.scale).toBeCloseTo(.19);
    expect(end.turn).toBe(1); expect(end.fall).toBe(1);
  });

  it('disposes every owned geometry and material once', () => {
    const bin = createShelfTrash();
    const geometries = new Set(), materials = new Set();
    bin.traverse(mesh => { if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) materials.add(mesh.material); });
    let disposedGeometry = 0, disposedMaterial = 0;
    for (const geometry of geometries) geometry.addEventListener('dispose', () => disposedGeometry++);
    for (const material of materials) material.addEventListener('dispose', () => disposedMaterial++);
    bin.userData.dispose(); bin.userData.dispose();
    expect(disposedGeometry).toBe(geometries.size); expect(disposedMaterial).toBe(materials.size);
  });
});
