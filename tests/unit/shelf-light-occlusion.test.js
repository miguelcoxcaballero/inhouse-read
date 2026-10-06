import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyShelfOccluders, clearShelfOccluders, shelfOcclusionUniforms, shelfOccluders } from '../../src/js/shelf-light-occlusion.js';
import { createShelfFurniture } from '../../src/js/shelf-furniture.js';
import { createBaggebo } from '../../src/js/baggebo-model.js';
import { WALNUT_SPEC } from '../../src/js/shelf-types.js';

const walnut = () => createShelfFurniture({ width:WALNUT_SPEC.width, height:WALNUT_SPEC.height, depth:WALNUT_SPEC.depth, scale:1,
  rows:WALNUT_SPEC.shelfBottoms.map(bottom => ({ bottom })), wood:new THREE.MeshStandardMaterial() });

// The shader's test, line by line, on the uniforms the module fills.
function seen(surface, lampPosition) {
  const { cabinet:c, boards } = shelfOcclusionUniforms();
  if (c[3] < .5) return 1;
  const axis = index => new THREE.Vector3(c[index * 4], c[index * 4 + 1], c[index * 4 + 2]);
  const centre = axis(3), local = position => { const offset = position.clone().sub(centre); return [0, 1, 2].map(index => offset.dot(axis(index))); };
  const lamp = local(lampPosition);
  if (lamp.some((value, index) => Math.abs(value) > c[16 + index])) return 1;
  const below = Math.max(-1e6, ...[...boards].filter(height => height <= lamp[1]));
  const above = Math.min(1e6, ...[...boards].filter(height => height > lamp[1]));
  const through = c[19], inner = c[7], front = c[11], point = local(surface);
  if (point[1] > below && point[1] < above)
    return c[15] > .5 && (Math.abs(point[0]) > inner && point[2] < front || point[2] < -c[18]) ? through : 1;
  if (point[2] <= front || lamp[2] >= front) return through;
  const t = (front - lamp[2]) / (point[2] - lamp[2]), x = lamp[0] + (point[0] - lamp[0]) * t, y = lamp[1] + (point[1] - lamp[1]) * t;
  return y > below && y < above && Math.abs(x) < inner ? 1 : through;
}

function view(root) {
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  camera.position.set(300, -200, 1600); camera.lookAt(0, -580, -125); camera.updateMatrixWorld();
  root.updateMatrixWorld(true);
  // Millimetres: a walnut cabinet is built in reference units and scaled.
  const mm = 1 / root.scale.x;
  return { camera, at:(x, y, z) => new THREE.Vector3(x, y, z).multiplyScalar(mm).applyMatrix4(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse) };
}

describe('cabinet boards stop the shelf lamps', () => {
  it('adds a loop-free test to every light type of the lit programs, as uniforms only', () => {
    const begin = THREE.ShaderChunk.lights_fragment_begin, pars = THREE.ShaderChunk.lights_pars_begin;
    expect(begin).toContain('shelfLampOcclusion( shelfLampSurface, spotLight.position )');
    expect(begin).toContain('shelfLampOcclusion( shelfLampSurface, pointLight.position )');
    expect(begin).toContain('rectAreaLight.color *= shelfLampOcclusion');
    const body = pars.slice(pars.indexOf('float shelfLampOcclusion'));
    expect(body).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\[\s*[a-z]\w*\s*\]/i);
    for (const name of ['standard', 'physical']) {
      const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib[name].uniforms);
      expect(uniforms.shelfLampCabinet.value).toBe(shelfOcclusionUniforms().cabinet);
    }
  });

  it('keeps a walnut lamp\'s light inside its compartment and the room in front', () => {
    const root = walnut(), description = shelfOccluders(root), { camera, at } = view(root);
    expect(description.boards).toHaveLength(4);
    expect(description.solidSides).toBe(true);
    applyShelfOccluders(root, description, camera);
    const [top, middle] = WALNUT_SPEC.shelfBottoms;
    const lamp = at(0, -top + 150, -125);
    expect(seen(at(80, -top + 1, -60), lamp)).toBe(1); // its own shelf
    expect(seen(at(80, -middle + 1, -60), lamp)).toBe(0); // the shelf below
    expect(seen(at(80, -top - 30, -60), lamp)).toBe(0); // the board's underside
    expect(seen(at(WALNUT_SPEC.width / 2 + 40, -top + 100, -125), lamp)).toBe(0); // the wall beside the cabinet
    expect(seen(at(0, -top + 100, -WALNUT_SPEC.depth - 40), lamp)).toBe(0); // the wall behind it
    expect(seen(at(0, -top + 100, 400), lamp)).toBe(1); // the room in front of it
    expect(seen(at(0, -middle, 900), lamp)).toBe(1); // the floor far in front, through the opening
    // A light outside the cabinet (the room's own) is never stopped.
    expect(seen(at(80, -middle + 1, -60), at(0, 800, 1200))).toBe(1);
    clearShelfOccluders();
    expect(seen(at(80, -middle + 1, -60), lamp)).toBe(1);
  });

  it('lets half the light through a BAGGEBO mesh shelf, whose sides are open', () => {
    const root = createBaggebo({ width:600 }), description = shelfOccluders(root), { camera, at } = view(root);
    expect(description.through).toBe(.5); expect(description.solidSides).toBe(false);
    applyShelfOccluders(root, description, camera);
    const lamp = at(0, -360 + 150, -125);
    expect(seen(at(80, -360 + 1, -60), lamp)).toBe(1);
    expect(seen(at(80, -682.5 + 1, -60), lamp)).toBe(.5);
    expect(seen(at(340, -360 + 100, -125), lamp)).toBe(1);
    clearShelfOccluders();
  });

  it('describes a wide cabinet of several units with the same boards', () => {
    const group = new THREE.Group();
    const left = walnut(), right = walnut(); right.position.x = 700; group.add(left, right);
    expect(shelfOccluders(group).boards).toHaveLength(4);
  });
});
