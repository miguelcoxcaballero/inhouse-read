import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyShelfOccluders, clearShelfOccluders, shelfOcclusionUniforms, shelfOccluders } from '../../src/js/shelf-light-occlusion.js';
import { createShelfFurniture } from '../../src/js/shelf-furniture.js';
import { createBaggebo } from '../../src/js/baggebo-model.js';
import { WALNUT_SPEC } from '../../src/js/shelf-types.js';

const walnut = () => createShelfFurniture({ width:WALNUT_SPEC.width, height:WALNUT_SPEC.height, depth:WALNUT_SPEC.depth, scale:1,
  rows:WALNUT_SPEC.shelfBottoms.map(bottom => ({ bottom })), wood:new THREE.MeshStandardMaterial() });

// The shader's test, in JavaScript, on the uniforms the module fills.
function seen(surface, lamp) {
  const { frame, occluders } = shelfOcclusionUniforms(), count = Math.round(frame[15]);
  const v = index => new THREE.Vector3(frame[index * 4], frame[index * 4 + 1], frame[index * 4 + 2]);
  const axes = [v(0), v(1), v(2)], centre = v(3), half = v(4);
  if (!count) return 1;
  const local = lamp.clone().sub(centre);
  if (axes.some((axis, index) => Math.abs(local.dot(axis)) > half.getComponent(index))) return 1;
  let light = 1;
  for (let index = 0; index < count; index++) {
    const placement = new THREE.Vector3(occluders[index * 8], occluders[index * 8 + 1], occluders[index * 8 + 2]);
    const axis = occluders[index * 8 + 3], normal = axes[axis];
    const a = normal.dot(surface.clone().sub(placement)), b = normal.dot(lamp.clone().sub(placement));
    if (a * b >= 0) continue;
    const crossing = surface.clone().add(lamp.clone().sub(surface).multiplyScalar(a / (a - b))).sub(placement);
    const first = axis === 0 ? axes[1] : axes[0], second = axis === 2 ? axes[1] : axes[2];
    if (Math.abs(crossing.dot(first)) <= occluders[index * 8 + 4] && Math.abs(crossing.dot(second)) <= occluders[index * 8 + 5]) light *= occluders[index * 8 + 6];
  }
  return light;
}

function view(cabinet) {
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  camera.position.set(300, -200, 1600); camera.lookAt(0, -580, -125); camera.updateMatrixWorld();
  cabinet.updateMatrixWorld(true);
  // Millimetres: a walnut cabinet is built in reference units and scaled.
  const mm = 1 / cabinet.scale.x;
  return { camera, at:(x, y, z) => new THREE.Vector3(x, y, z).multiplyScalar(mm).applyMatrix4(cabinet.matrixWorld).applyMatrix4(camera.matrixWorldInverse) };
}

describe('cabinet boards stop the shelf lamps', () => {
  it('adds the occlusion to every light type of the lit programs, as uniforms only', () => {
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('shelfLampOcclusion( geometryPosition, spotLight.position )');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('shelfLampOcclusion( geometryPosition, pointLight.position )');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('rectAreaLight.color *= shelfLampOcclusion');
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('uniform vec4 shelfOccluders[');
    for (const name of ['standard', 'physical']) {
      const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib[name].uniforms);
      expect(uniforms.shelfOccluders.value).toBe(shelfOcclusionUniforms().occluders);
    }
  });

  it('keeps a walnut lamp\'s light inside its compartment', () => {
    const cabinet = walnut(), description = shelfOccluders(cabinet), { camera, at } = view(cabinet);
    expect(description.list.length).toBeGreaterThanOrEqual(7);
    applyShelfOccluders(cabinet, description, camera);
    const [top, middle] = WALNUT_SPEC.shelfBottoms;
    const lamp = at(0, -top + 150, -125);
    expect(seen(at(80, -top + 1, -60), lamp)).toBe(1); // its own shelf
    expect(seen(at(80, -middle + 1, -60), lamp)).toBe(0); // the shelf below
    expect(seen(at(80, -top - 30, -60), lamp)).toBe(0); // the board's underside
    expect(seen(at(WALNUT_SPEC.width / 2 + 40, -top + 100, -125), lamp)).toBe(0); // the wall beside the cabinet
    expect(seen(at(0, -top + 100, 400), lamp)).toBe(1); // the room in front of it
    // A light outside the cabinet (the room's own) is never stopped.
    expect(seen(at(80, -middle + 1, -60), at(0, 800, 1200))).toBe(1);
    clearShelfOccluders();
    expect(seen(at(80, -middle + 1, -60), lamp)).toBe(1);
  });

  it('lets half the light through a BAGGEBO mesh shelf', () => {
    const cabinet = createBaggebo({ width:600 }), description = shelfOccluders(cabinet), { camera, at } = view(cabinet);
    expect(description.list.every(occluder => occluder.through === .5)).toBe(true);
    applyShelfOccluders(cabinet, description, camera);
    const lamp = at(0, -360 + 150, -125);
    expect(seen(at(80, -360 + 1, -60), lamp)).toBe(1);
    expect(seen(at(80, -682.5 + 1, -60), lamp)).toBe(.5);
    clearShelfOccluders();
  });

  it('describes every unit of a wide cabinet', () => {
    const group = new THREE.Group();
    const left = walnut(), right = walnut(); right.position.x = 700; group.add(left, right);
    expect(shelfOccluders(group).list.length).toBe(2 * shelfOccluders(walnut()).list.length);
  });
});
