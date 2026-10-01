import { describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { createShelfLamp } from '../../src/js/shelf-lamps.js';
import { createShelfLampLighting,MAX_SHELF_LAMP_LIGHTS } from '../../src/js/shelf-lamp-lighting.js';

function setup() {
  const scene = new THREE.Scene(), room = new THREE.Group(); scene.add(room);
  const model = createShelfLamp({lampId:'tarnaby',width:75}); room.add(model);
  const entry = {kind:'lamp',key:'test-filaments',model,width:75};
  const manager = createShelfLampLighting(scene);
  return {scene,room,model,entry,manager,lights:() => scene.children.filter(object => object.userData.shelfLamp)};
}

describe('continuous LED filament illumination', () => {
  it('emits from four physical strips along the visible fibres, with no central point light', () => {
    const s = setup(); s.manager.update([s.entry]);
    expect(s.manager.activeCount).toBe(1); expect(s.manager.shadowCount).toBe(0);
    expect(s.lights()).toHaveLength(4);
    s.lights().forEach((light,index) => {
      expect(light.isRectAreaLight).toBe(true); expect(light.isPointLight).not.toBe(true);
      const strip = s.model.userData.lightEmitter.filaments[index];
      const start = new THREE.Vector3(...strip.start), end = new THREE.Vector3(...strip.end);
      expect(light.position.distanceTo(start.clone().add(end).multiplyScalar(.5))).toBeLessThan(1e-8);
      expect(light.height).toBeCloseTo(start.distanceTo(end)); expect(light.width).toBeCloseTo(strip.width);
      const outward = new THREE.Vector3(0,0,-1).applyQuaternion(light.quaternion);
      expect(outward.dot(new THREE.Vector3(...strip.normal))).toBeGreaterThan(.9999);
    });
    s.manager.dispose(); s.model.dispose();
  });

  it('keeps the emitting strips aligned with a moved and rotated bulb without changing radiance under zoom', () => {
    const s = setup(); s.manager.update([s.entry]);
    const initial = s.lights(), intensity = initial[0].intensity, width = initial[0].width, height = initial[0].height;
    s.room.position.set(60,30,-90); s.room.rotation.set(.2,-.7,.1); s.room.scale.setScalar(2.4);
    s.room.updateMatrixWorld(true); s.manager.update([s.entry],{transform:s.room.matrixWorld});
    expect(s.lights()).toEqual(initial);
    initial.forEach((light,index) => {
      const strip = s.model.userData.lightEmitter.filaments[index];
      const center = new THREE.Vector3(...strip.start).add(new THREE.Vector3(...strip.end)).multiplyScalar(.5);
      expect(light.position.distanceTo(s.model.localToWorld(center))).toBeLessThan(1e-8);
      expect(light.width).toBeCloseTo(width*2.4); expect(light.height).toBeCloseTo(height*2.4);
      expect(light.intensity).toBeCloseTo(intensity);
    });
    expect(s.manager.update([s.entry],{transform:s.room.matrixWorld})).toBe(false);
    s.manager.dispose(); s.model.dispose();
  });

  it('fades the actual emitting surfaces together with the visible fibres and releases all four when off', () => {
    const s = setup(); s.manager.update([s.entry]);
    const initial = s.lights(), intensity = initial[0].intensity;
    const material = s.model.getObjectByName('glowing-retro-led-filaments').material, glow = material.emissiveIntensity;
    for (const power of [.2,.6,1]) {
      s.model.userData.setPower(power); s.manager.update([s.entry]);
      expect(s.lights()).toEqual(initial);
      for (const light of initial) expect(light.intensity).toBeCloseTo(intensity*power);
      expect(material.emissiveIntensity).toBeCloseTo(glow*power);
    }
    s.model.userData.setPower(0); s.manager.update([s.entry]);
    expect(s.lights()).toHaveLength(0); expect(initial.every(light => !light.parent)).toBe(true);
    expect(s.manager.activeCount).toBe(0); expect(material.emissiveIntensity).toBe(0);
    s.model.userData.setPower(1); s.manager.update([s.entry]);
    expect(s.lights()).toHaveLength(4); expect(s.lights()[0]).not.toBe(initial[0]);
    s.manager.dispose(); expect(s.lights()).toHaveLength(0); s.model.dispose();
  });

  it('keeps the same bounded fixture budget even with many filament lamps', () => {
    const s = setup(), entries = Array.from({length:9},(_,index) => ({...s.entry,key:`lamp:${index}`}));
    s.manager.update(entries);
    expect(s.manager.activeCount).toBe(MAX_SHELF_LAMP_LIGHTS);
    expect(s.lights()).toHaveLength(MAX_SHELF_LAMP_LIGHTS*4);
    expect(s.manager.shadowCount).toBe(0);
    s.manager.dispose(); s.model.dispose();
  });
});
