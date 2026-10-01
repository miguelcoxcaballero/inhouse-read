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

  it('uses four correctly oriented triangular posts instead of solid square profiles', () => {
    const shelf = createBaggebo();
    shelf.updateMatrixWorld(true);
    const painted = shelf.children.find(child => child.material.name.includes('powder-coated'));
    const uprights = shelf.userData.parts.filter(part => part.kind === 'upright');
    for (const part of uprights) {
      expect(part.profile).toBe('rounded-right-triangle');
      expect(part.bounds.getSize(new THREE.Vector3()).toArray()).toEqual([18, 1153, 18]);
    }
    for (const side of [-1, 1]) for (const front of [-1, 1]) {
      const outerZ = front > 0 ? 0 : -250;
      // The inner half of each old square must now be genuinely empty.
      const empty = new THREE.Raycaster(new THREE.Vector3(side * 285, -590, outerZ - front * 15),
        new THREE.Vector3(0, -1, 0), 0, 20);
      expect(empty.intersectObject(painted)).toHaveLength(0);
      const ray = new THREE.Raycaster(new THREE.Vector3(side * 280, -600, outerZ - front * 20),
        new THREE.Vector3(side, 0, front).normalize(), 0, 100);
      const [hit] = ray.intersectObject(painted);
      expect(hit).toBeDefined();
      // Its exposed diagonal faces inwards and sits at 45° in every corner.
      expect(hit.face.normal.x).toBeCloseTo(-side / Math.SQRT2, 5);
      expect(hit.face.normal.z).toBeCloseTo(-front / Math.SQRT2, 5);
      expect(hit.face.normal.y).toBeCloseTo(0, 10);
      expect(300 - Math.abs(hit.point.x) + front * (outerZ - hit.point.z)).toBeCloseTo(uprights[0].diagonal, 4);
    }
    const feet = shelf.userData.parts.filter(part => part.kind === 'foot');
    for (const foot of feet) {
      expect(foot.bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(11.2, 4);
      expect(foot.bounds.min.y).toBe(-1160);
    }
    shelf.userData.dispose();
  });

  it('fits chamfered folded pans and diagonal fixing heads to the triangular posts', () => {
    const shelf = createBaggebo();
    const rims = shelf.userData.parts.filter(part => part.kind === 'shelf-rim');
    expect(rims).toHaveLength(4);
    for (const rim of rims) {
      expect(rim.outline).toHaveLength(8);
      expect(rim.bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(598.7, 4);
      expect(rim.bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(248.7, 4);
      for (const [x, z] of rim.outline) {
        const frontInset = Math.min(-z, 250 + z);
        expect(300 - Math.abs(x) + frontInset).toBeCloseTo(rim.cornerCut, 8);
      }
      expect(rim.cornerCut).toBeGreaterThan(shelf.userData.parts.find(part => part.kind === 'upright').diagonal);
    }
    const fixings = shelf.userData.parts.filter(part => part.kind === 'screw' && /(?:front|back)-fixing/.test(part.name));
    expect(fixings).toHaveLength(16);
    for (const fixing of fixings) {
      expect(Math.abs(fixing.axis[0])).toBeCloseTo(1 / Math.SQRT2, 8);
      expect(Math.abs(fixing.axis[2])).toBeCloseTo(1 / Math.SQRT2, 8);
      expect(fixing.axis[1]).toBe(0);
    }
    expect(shelf.userData.parts.filter(part => part.kind === 'mount-tab')).toHaveLength(16);
    expect(shelf.userData.parts.filter(part => part.kind === 'fixing-shank')).toHaveLength(16);
    shelf.userData.dispose();
  });

  it('uses physical mesh openings and thickness for raycasting, grazing views and shadows', () => {
    const shelf = createBaggebo();
    shelf.updateMatrixWorld(true);
    const mesh = shelf.children.find(child => child.material.name === 'Open expanded white-painted steel');
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, -528, 20), new THREE.Vector3(0, 0, -1));
    // Both the back brace and the top panel have actual holes. The stock
    // raycaster sees through them, with no alpha sampling or custom override.
    expect(raycaster.intersectObject(mesh)).toHaveLength(0);
    raycaster.ray.origin.x = 3.6;
    expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
    raycaster.ray.set(new THREE.Vector3(0, 10, -72), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(mesh)).toHaveLength(0);
    raycaster.ray.origin.z = -75.6;
    expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
    expect(mesh.material.alphaMap).toBeNull();
    expect(mesh.customDepthMaterial).toBeUndefined();
    expect(mesh.customDistanceMaterial).toBeUndefined();
    expect(mesh.material.side).toBe(THREE.DoubleSide);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    const top = shelf.userData.parts.find(part => part.kind === 'mesh-top');
    expect(top.bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(.65, 5);
    expect(shelf.userData.parts.filter(part => part.kind === 'folded-lip')).toHaveLength(4);
    shelf.userData.dispose();
  });

  it('batches all parts into four draw calls and keeps geometry finite for mobile rendering', () => {
    const shelf = createBaggebo();
    expect(shelf.children).toHaveLength(4);
    const triangles = shelf.children.reduce((total, mesh) => total + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
    expect(triangles).toBeLessThan(80000);
    for (const mesh of shelf.children) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.geometry.attributes.position.array.every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.attributes.normal.array.every(Number.isFinite)).toBe(true);
      expect(mesh.geometry.attributes.uv.array.every(Number.isFinite)).toBe(true);
    }
    const painted = shelf.children.find(mesh => mesh.material.name.includes('powder-coated'));
    expect(painted.material.roughness).toBeGreaterThan(.3);
    expect(painted.material.metalness).toBeLessThan(.2);
    expect(painted.material.bumpScale).toBeLessThan(.04);
    // Long posts repeat the same sub-millimetre paint grain as short rails.
    expect(painted.geometry.attributes.uv.array.some(value => Math.abs(value) > 100)).toBe(true);
    shelf.userData.dispose();
  });

  it('keeps the complete pressed mesh while reducing vertex work and GPU storage', () => {
    const shelf = createBaggebo();
    let vertices = 0, triangles = 0, bytes = 0, validNormals = true;
    for (const mesh of shelf.children) {
      const geometry = mesh.geometry, normal = geometry.getAttribute('normal');
      expect(geometry.index).not.toBeNull();
      vertices += geometry.attributes.position.count;
      triangles += geometry.index.count / 3;
      bytes += geometry.index.array.byteLength;
      for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
      for (let index = 0; index < normal.count; index += 1) {
        const length = Math.hypot(normal.getX(index), normal.getY(index), normal.getZ(index));
        if (length !== 0 && Math.abs(length - 1) > .00003) validNormals = false;
      }
    }
    // All 61,690 original pressed-sheet triangles survive the profile fix;
    // uprights, pans and hardware remain small compared with that sheet.
    const sheet = shelf.children.find(mesh => mesh.material.name === 'Open expanded white-painted steel');
    expect(sheet.geometry.index.count / 3).toBe(61690);
    expect(triangles).toBeLessThan(70226);
    expect(vertices).toBeLessThan(147000);
    expect(bytes).toBeLessThan(4700000);
    expect(validNormals).toBe(true);
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
    const firstPaint = first.children.find(mesh => mesh.material.bumpMap).material.bumpMap;
    const secondPaint = second.children.find(mesh => mesh.material.bumpMap).material.bumpMap;
    expect(firstPaint).not.toBe(secondPaint);
    first.children.forEach((mesh, index) => {
      expect(mesh.geometry).not.toBe(second.children[index].geometry);
      expect(mesh.geometry.attributes.position.array === second.children[index].geometry.attributes.position.array).toBe(false);
      expect(mesh.geometry.index.array).not.toBe(second.children[index].geometry.index.array);
    });
    const secondBounds = second.userData.parts[0].bounds.clone();
    first.userData.parts[0].bounds.min.setScalar(123);
    expect(second.userData.parts[0].bounds.equals(secondBounds)).toBe(true);
    secondPaint.addEventListener('dispose', () => { secondDisposals += 1; });
    first.userData.dispose(); first.userData.disposeGeometry();
    expect(disposals).toBe(resources.size);
    expect(secondDisposals).toBe(0);
    second.userData.dispose();
    expect(secondDisposals).toBe(1);
  });
});
