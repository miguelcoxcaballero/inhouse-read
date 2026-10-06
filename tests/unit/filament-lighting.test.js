import { beforeAll,describe,expect,it } from 'vitest';
import * as THREE from 'three';
import { createShelfLamp } from '../../src/js/shelf-lamps.js';
import { createShelfLampLighting,ensureAreaLights,MAX_SHELF_LAMP_LIGHTS } from '../../src/js/shelf-lamp-lighting.js';

// The area-light tables load on demand (see shelf-lamp-lighting.js).
beforeAll(async () => { await ensureAreaLights(); });

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

  it('fades the actual emitting surfaces together with the visible fibres and keeps all four, dark, when off', () => {
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
    // Adding or removing a light would recompile every shader of the room.
    expect(s.lights()).toEqual(initial); expect(initial.every(light => light.parent === s.scene && light.intensity === 0)).toBe(true);
    expect(s.manager.activeCount).toBe(0); expect(material.emissiveIntensity).toBe(0);
    s.model.userData.setPower(1); s.manager.update([s.entry]);
    expect(s.lights()).toEqual(initial); expect(s.lights()[0].intensity).toBeCloseTo(intensity);
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

describe('quiet change detection for every lamp type', () => {
  const entryFor = (lampId, key = lampId) => {
    const model = createShelfLamp({lampId,width:75}); model.position.set(40,-30,10); model.updateMatrixWorld(true);
    return {kind:'lamp',key,model,width:75};
  };

  it.each(['tarnaby','mittled','tripod'])('%s: reports a change only when its light really changed', lampId => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene), entry = entryFor(lampId);
    scene.add(entry.model);
    expect(manager.update([entry])).toBe(true);
    for (let frame = 0; frame < 3; frame++) expect(manager.update([entry])).toBe(false);
    entry.model.position.x += 12; entry.model.updateMatrixWorld(true);
    expect(manager.update([entry])).toBe(true); expect(manager.update([entry])).toBe(false);
    entry.model.userData.setPower(.4);
    expect(manager.update([entry])).toBe(true); expect(manager.update([entry])).toBe(false);
    expect(manager.activePower).toBeCloseTo(.4);
    entry.model.userData.setPower(0);
    expect(manager.update([entry])).toBe(true); expect(manager.activeCount).toBe(0);
    expect(manager.update([entry])).toBe(false);
    manager.dispose(); entry.model.dispose();
  });

  it('counts only the cones that cast a shadow and redraws their map when a cone moves', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene);
    const entries = ['a','b','c'].map(key => entryFor('mittled',key)); entries.forEach(entry => scene.add(entry.model));
    manager.update(entries);
    expect(manager.activeCount).toBe(3); expect(manager.shadowCount).toBe(2);
    const shadowed = scene.children.filter(object => object.userData.shelfLamp && object.castShadow);
    for (const light of shadowed) light.shadow.needsUpdate = false;
    expect(manager.update(entries)).toBe(false);
    expect(shadowed.every(light => !light.shadow.needsUpdate)).toBe(true);
    entries[0].model.position.y -= 25; entries[0].model.updateMatrixWorld(true);
    expect(manager.update(entries)).toBe(true);
    expect(shadowed.some(light => light.shadow.needsUpdate)).toBe(true);
    manager.dispose(); expect(manager.shadowCount).toBe(0);
    entries.forEach(entry => entry.model.dispose());
  });

  it('retains none of the entries it was given and keeps lamps nearest the view centre', () => {
    const scene = new THREE.Scene(), manager = createShelfLampLighting(scene);
    // More lamps than lights: the ones nearest the view centre are lit.
    const entries = Array.from({length:MAX_SHELF_LAMP_LIGHTS + 2},(_,index) => ({...entryFor('tripod',`lamp:${index}`),
      rect:{top:index * 200,bottom:index * 200 + 100}}));
    entries.forEach(entry => scene.add(entry.model));
    manager.update(entries,{scroll:400,viewportHeight:200});
    const keys = () => scene.children.filter(object => object.userData.shelfLamp).map(light => light.userData.entryKey).sort();
    const first = Array.from({length:MAX_SHELF_LAMP_LIGHTS},(_,index) => `lamp:${index}`).sort();
    expect(keys()).toEqual(first);
    // The picked lamp keeps its light however far it is from the centre; it
    // takes the lit lamp furthest from the centre.
    const last = entries.at(-1);
    last.node = {classList:{contains:name => name === 'is-dragging'}};
    manager.update(entries,{scroll:400,viewportHeight:200});
    expect(keys()).toEqual([...first.filter(key => key !== `lamp:${MAX_SHELF_LAMP_LIGHTS - 1}`),last.key].sort());
    manager.update([]);
    expect(manager.activeCount).toBe(0); expect(keys()).toEqual([]);
    manager.dispose(); entries.forEach(entry => entry.model.dispose());
  });
});
