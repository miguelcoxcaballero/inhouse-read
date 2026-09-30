import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createShelfFurniture, createShelfOcclusion } from '../../src/js/shelf-furniture.js';

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

  it('closes every plank joint with a dark backer and seats the carcass on a recessed plinth', () => {
    const cabinet = create();
    const planks = cabinet.userData.parts.filter(part => part.name.startsWith('back-plank'));
    const backer = cabinet.userData.parts.find(part => part.name === 'back-backer').bounds;
    expect(backer.min.x).toBeLessThanOrEqual(planks[0].bounds.min.x);
    expect(backer.max.x).toBeGreaterThanOrEqual(planks.at(-1).bounds.max.x);
    expect(backer.max.z).toBeLessThanOrEqual(Math.min(...planks.map(part => part.bounds.min.z)) + 1e-6);
    const plinth = cabinet.userData.parts.find(part => part.name === 'plinth').bounds;
    const lip = cabinet.userData.parts.find(part => part.name === 'shelf-2-lip').bounds;
    expect(plinth.min.y).toBeCloseTo(-636, 5);
    expect(plinth.max.y).toBeCloseTo(lip.min.y, 5);
    expect(plinth.max.z).toBeLessThan(lip.max.z - 6);
    cabinet.userData.disposeGeometry();
  });

  it('tints each board deterministically and darkens only its end grain', () => {
    const first = create(), second = create();
    const mesh = first.children.find(child => child.name === 'Shelf timber and rounded fronts');
    const colors = mesh.geometry.getAttribute('color'), normals = mesh.geometry.getAttribute('normal');
    const positions = mesh.geometry.getAttribute('position');
    expect(colors.itemSize).toBe(3);
    expect(colors.array).toEqual(second.children.find(child => child.name === mesh.name).geometry.getAttribute('color').array);
    const tones = new Set(), sideTones = [], endTones = [];
    for (let index = 0; index < colors.count; index += 1) {
      const green = colors.getY(index);
      expect(green).toBeGreaterThan(0.5); expect(green).toBeLessThan(1.1);
      tones.add(green.toFixed(4));
      // The first shelf board and its lip run along x: faces along x are end grain.
      const y = positions.getY(index);
      if (y < -207.01 || y > -191.99) continue;
      (Math.abs(normals.getX(index)) > 0.999 ? endTones : sideTones).push(green);
    }
    expect(tones.size).toBeGreaterThan(4);
    expect(endTones.length).toBeGreaterThan(0);
    expect(Math.max(...endTones)).toBeLessThan(Math.min(...sideTones) * 0.7);
    first.userData.disposeGeometry(); second.userData.disposeGeometry();
  });

  it('bakes corner occlusion and floor contact into one bounded, transparent geometry', () => {
    const rows = Array.from({ length:3 }, (_, index) => ({ top:index * 212 + 20, bottom:(index + 1) * 212 - 20 }));
    const bare = createShelfOcclusion({ width:390, height:636, depth:155, rows, floorY:-636 });
    const binned = createShelfOcclusion({ width:390, height:636, depth:155, rows, floorY:-636,
      footprints:[{ x:250, z:-155, radius:44 }, { x:NaN, z:0, radius:10 }, { x:0, z:0, radius:-1 }] });
    const colors = bare.getAttribute('color'), positions = bare.getAttribute('position');
    expect(colors.itemSize).toBe(4);
    for (let index = 0; index < colors.count; index += 1) {
      expect([colors.getX(index), colors.getY(index), colors.getZ(index)]).toEqual([0, 0, 0]);
      expect(colors.getW(index)).toBeGreaterThanOrEqual(0); expect(colors.getW(index)).toBeLessThanOrEqual(0.7);
    }
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    expect(bare.boundingBox.min.y).toBeCloseTo(-636 + 0.25, 5);
    expect(bare.boundingBox.max.y).toBeLessThanOrEqual(0);
    // Both outer sides fade toward the floor: dark at the ground, clear above.
    for (const side of [-1, 1]) {
      const fade = [...Array(positions.count).keys()].filter(index => Math.abs(positions.getX(index) - side * 195.3) < 1e-3);
      expect(fade.length).toBe(6);
      for (const index of fade) expect(colors.getW(index)).toBeCloseTo(positions.getY(index) < -600 ? .3 : 0, 5);
    }
    // Only the valid wastebasket adds a contact shadow, beside the cabinet.
    expect(binned.getAttribute('position').count - positions.count).toBe(20 * 15);
    expect(binned.boundingBox.max.x).toBeGreaterThan(250 + 44);
    const hundred = createShelfOcclusion({ width:390, height:100 * 212, depth:155, floorY:-100 * 212,
      rows:Array.from({ length:100 }, (_, index) => ({ bottom:(index + 1) * 212 - 20 })) });
    expect(hundred.getAttribute('position').count / 3).toBeLessThan(100 * 28 + 40);
    for (const geometry of [bare, binned, hundred]) geometry.dispose();
  });

  it('lays a faint floor pool under the contact shadows only on request, never past the left contact', () => {
    const rows = Array.from({ length:3 }, (_, index) => ({ top:index * 212 + 20, bottom:(index + 1) * 212 - 20 }));
    const options = { width:390, height:636, depth:155, rows, floorY:-636, footprints:[{ x:250, z:-155, radius:44 }] };
    const bare = createShelfOcclusion(options);
    const lit = createShelfOcclusion({ ...options, floorLight:[.5, .4, .29, .11] });
    const added = lit.getAttribute('position').count - bare.getAttribute('position').count;
    expect(added / 3).toBe(120);
    const colors = lit.getAttribute('color'), positions = lit.getAttribute('position');
    const pool = [...Array(colors.count).keys()].filter(index => colors.getX(index) > 0);
    expect(pool).toHaveLength(added); expect(pool.at(-1) - pool[0] + 1).toBe(added);
    // The first thing drawn on the floor, so every contact shadow darkens the
    // pool, never the reverse.
    for (let index = 0; index < colors.count; index += 1) {
      const tinted = index >= pool[0] && index <= pool.at(-1);
      expect(colors.getW(index)).toBeLessThanOrEqual(tinted ? .11 + 1e-9 : .7);
      if (tinted) expect(positions.getY(index)).toBeCloseTo(-636 + .25, 5);
      else if (index < pool[0]) expect(positions.getY(index)).toBeGreaterThan(-636 + 1);
    }
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    // Beyond the bin on the right; on the left no wider than the contact
    // shadow itself, where a narrow screen's canvas edge would crop it.
    expect(lit.boundingBox.max.x).toBeGreaterThan(250 + 44 * 1.42 + 6);
    expect(lit.boundingBox.min.x).toBeGreaterThanOrEqual(bare.boundingBox.min.x);
    for (const floorLight of [[1, 1, 1], [NaN, 0, 0, .1], 'warm', {}]) {
      const ignored = createShelfOcclusion({ ...options, floorLight });
      expect(ignored.getAttribute('position').count).toBe(bare.getAttribute('position').count);
      ignored.dispose();
    }
    bare.dispose(); lit.dispose();
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
