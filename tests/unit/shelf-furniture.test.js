import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createShelfFurniture } from '../../src/js/shelf-furniture.js';

function create(count = 3, overrides = {}) {
  return createShelfFurniture({
    width:390,
    height:count * 212,
    depth:155,
    rows:Array.from({ length:count }, (_, index) => ({ top:index * 212 + 20, bottom:(index + 1) * 212 - 20 })),
    wood:new THREE.MeshStandardMaterial(),
    backWood:new THREE.MeshStandardMaterial(),
    darkWood:new THREE.MeshStandardMaterial(),
    ...overrides
  });
}

describe('createShelfFurniture', () => {
  it('keeps the cabinet footprint and every shelf top at its book baseline', () => {
    const cabinet = create();
    const bounds = new THREE.Box3().setFromObject(cabinet);
    expect(cabinet.userData.furniture).toBe(true);
    expect(bounds.min.x).toBe(-195);
    expect(bounds.max.x).toBe(195);
    expect(bounds.max.y).toBe(0);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-636 - 15);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-155 - 4);
    expect(bounds.max.z).toBeLessThanOrEqual(12);
    for (let index = 0; index < 3; index += 1) {
      const board = cabinet.userData.parts.find(part => part.name === `shelf-${index}-board`);
      const lip = cabinet.userData.parts.find(part => part.name === `shelf-${index}-lip`);
      expect(board.bounds.max.y).toBeCloseTo(-((index + 1) * 212 - 20), 5);
      expect(lip.bounds.max.y).toBeCloseTo(board.bounds.max.y, 5);
      expect(board.bounds.min.y).toBeCloseTo(board.bounds.max.y - 15, 5);
    }
    cabinet.userData.disposeGeometry();
  });

  it('uses actual bevels, curved front profiles and separate recessed plank joints', () => {
    const cabinet = create();
    let diagonalNormals = 0;
    for (const mesh of cabinet.children) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      const normals = mesh.geometry.getAttribute('normal');
      for (let index = 0; index < normals.count; index += 1) {
        const vector = new THREE.Vector3().fromBufferAttribute(normals, index);
        expect(vector.length()).toBeCloseTo(1, 5);
        if ([vector.x, vector.y, vector.z].filter(component => Math.abs(component) > 0.1).length > 1) diagonalNormals += 1;
      }
    }
    expect(diagonalNormals).toBeGreaterThan(100);
    const planks = cabinet.userData.parts.filter(part => part.name.startsWith('back-plank'));
    expect(planks.length).toBeGreaterThan(2);
    expect(planks[1].bounds.min.x - planks[0].bounds.max.x).toBeCloseTo(0.85, 4);
    expect(planks[0].bounds.max.z).toBeLessThan(-150);
    const lip = cabinet.userData.parts.find(part => part.name === 'shelf-0-lip');
    expect(lip.bounds.max.z).toBeGreaterThan(11);
    cabinet.userData.disposeGeometry();
  });

  it('maps horizontal board grain in physical units instead of stretching with its width', () => {
    const cabinet = create();
    const mesh = cabinet.children.find(mesh => mesh.name === 'Shelf timber and rounded fronts');
    const positions = mesh.geometry.getAttribute('position');
    const normals = mesh.geometry.getAttribute('normal');
    const uvs = mesh.geometry.getAttribute('uv');
    const points = [];
    for (let index = 0; index < positions.count; index += 1) {
      if (Math.abs(positions.getZ(index) - 7) < 0.0001 &&
          Math.abs(positions.getY(index) + 192.65) < 0.0001 && normals.getZ(index) > 0.999) {
        points.push({ x:positions.getX(index), u:uvs.getX(index) });
      }
    }
    const left = points.sort((a, b) => a.x - b.x)[0];
    const right = points.at(-1);
    expect(left).toBeDefined(); expect(right).toBeDefined();
    expect(right.u - left.u).toBeCloseTo((right.x - left.x) / 160, 5);
    expect(cabinet.userData.textureScale).toBe(160);
    cabinet.userData.disposeGeometry();
  });

  it('varies plank and shelf texture offsets deterministically', () => {
    const first = create(), second = create();
    for (let index = 0; index < first.children.length; index += 1) {
      expect(first.children[index].geometry.getAttribute('uv').array).toEqual(second.children[index].geometry.getAttribute('uv').array);
    }
    const mesh = first.children.find(mesh => mesh.name === 'Shelf timber and rounded fronts');
    const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal'), uvs = mesh.geometry.getAttribute('uv');
    const offsets = [];
    for (let row = 0; row < 3; row += 1) {
      const y = -((row + 1) * 212 - 20) - 0.65;
      for (let index = 0; index < positions.count; index += 1) {
        if (Math.abs(positions.getX(index) + 186.35) < 0.0001 &&
            Math.abs(positions.getY(index) - y) < 0.0001 &&
            Math.abs(positions.getZ(index) - 7) < 0.0001 && normals.getZ(index) > 0.999) {
          offsets.push(uvs.getX(index)); break;
        }
      }
    }
    expect(offsets).toHaveLength(3);
    expect(new Set(offsets).size).toBe(3);
    first.userData.disposeGeometry(); second.userData.disposeGeometry();
  });

  it('keeps a hundred rows under three cabinet draw calls and 16000 triangles', () => {
    const cabinet = create(100);
    expect(cabinet.children).toHaveLength(3);
    const triangles = cabinet.children.reduce((count, mesh) => count + mesh.geometry.getAttribute('position').count / 3, 0);
    expect(triangles).toBeLessThan(16000);
    for (const mesh of cabinet.children) {
      expect([...mesh.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
      expect([...mesh.geometry.getAttribute('normal').array].every(Number.isFinite)).toBe(true);
      expect([...mesh.geometry.getAttribute('uv').array].every(Number.isFinite)).toBe(true);
    }
    cabinet.userData.disposeGeometry();
  });

  it('disposes only its unique geometries, once, and leaves shared materials alive', () => {
    const material = new THREE.MeshStandardMaterial();
    let materialDisposals = 0, geometryDisposals = 0;
    material.addEventListener('dispose', () => { materialDisposals += 1; });
    const cabinet = create(3, { wood:material, backWood:material, darkWood:material });
    expect(cabinet.children).toHaveLength(1);
    for (const mesh of cabinet.children) mesh.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    cabinet.userData.disposeGeometry(); cabinet.userData.disposeGeometry();
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(0);
  });

  it('ignores malformed duplicate row entries and grows real depth on rebuild', () => {
    const cabinet = create(3, { depth:320, rows:[{ bottom:192 }, { bottom:192 }, null, { bottom:NaN }] });
    expect(cabinet.userData.parts.filter(part => part.name.endsWith('-board'))).toHaveLength(1);
    const bounds = new THREE.Box3().setFromObject(cabinet);
    expect(bounds.min.z).toBe(-323);
    expect(bounds.max.z).toBeLessThan(12);
    cabinet.userData.disposeGeometry();
  });
});
