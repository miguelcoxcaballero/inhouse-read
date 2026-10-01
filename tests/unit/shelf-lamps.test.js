import { describe,expect,it,vi } from 'vitest';
import * as THREE from 'three';
import { LAMP_CATALOG,getCatalogLamp,normalizeShelfLamp } from '../../src/js/lamp-catalog-data.js';
import { createShelfLamp } from '../../src/js/shelf-lamps.js';

describe('shelf lighting catalogue', () => {
  it('offers two small tabletop fixtures and one underside fixture with immutable physical sizes', () => {
    expect(LAMP_CATALOG).toHaveLength(3);
    expect(LAMP_CATALOG.filter(lamp => lamp.mount === 'standing')).toHaveLength(2);
    expect(LAMP_CATALOG.filter(lamp => lamp.mount === 'undershelf')).toHaveLength(1);
    for (const lamp of LAMP_CATALOG) {
      expect(getCatalogLamp(lamp.id)).toBe(lamp);
      expect(Object.isFrozen(lamp)).toBe(true); expect(Object.isFrozen(lamp.dimensions)).toBe(true);
      expect(lamp.warmKelvin).toBe(2700);
      expect(new URL(lamp.referenceUrl).hostname).toBe('www.ikea.com');
      expect(lamp.dimensions.height).toBeLessThanOrEqual(280);
    }
    expect(getCatalogLamp('unavailable')).toBeNull();
  });

  it('normalizes saved identities and placements without persisting screen-dependent sizes', () => {
    expect(normalizeShelfLamp({key:'lamp:a',lampId:'tripod',width:250,height:390,shelf:2.9,x:.7}))
      .toEqual({key:'lamp:a',seed:'lamp:a',lampId:'tripod',shelf:2,x:.7});
    expect(normalizeShelfLamp({seed:'lamp:old',lampId:'tarnaby',shelf:-2,x:Infinity}))
      .toEqual({key:'lamp:old',seed:'lamp:old',lampId:'tarnaby'});
    expect(normalizeShelfLamp({key:'lamp:a',seed:'stable',lampId:'mittled',shelf:9999,x:-.2}))
      .toEqual({key:'lamp:a',seed:'stable',lampId:'mittled',shelf:999,x:0});
    expect(normalizeShelfLamp(null)).toBeNull();
    expect(normalizeShelfLamp({lampId:'tripod'})).toBeNull();
    expect(normalizeShelfLamp({key:' ',seed:'',lampId:'tripod'})).toBeNull();
    expect(normalizeShelfLamp({key:'lamp:a',lampId:'unknown'})).toBeNull();
  });
});

describe('physical shelf lamp models', () => {
  for (const lamp of LAMP_CATALOG) {
    it(`${lamp.id} fits the support plane, collision envelope and mobile geometry budget`, () => {
      const model = createShelfLamp({lampId:lamp.id});
      const bounds = new THREE.Box3().setFromObject(model);
      expect(bounds.min.y).toBeCloseTo(lamp.mount === 'standing' ? 0 : -lamp.dimensions.height,4);
      expect(bounds.max.y).toBeCloseTo(lamp.mount === 'standing' ? lamp.dimensions.height : 0,4);
      expect(bounds.min.x).toBeCloseTo(-lamp.dimensions.width / 2,4);
      expect(bounds.max.x).toBeCloseTo(lamp.dimensions.width / 2,4);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-lamp.dimensions.depth / 2 - .0001);
      expect(bounds.max.z).toBeLessThanOrEqual(lamp.dimensions.depth / 2 + .0001);
      let draws = 0,triangles = 0,lights = 0;
      model.traverse(object => {
        if (object.isLight) lights++;
        if (!object.isMesh) return;
        draws++; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
        expect([...object.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
        expect([...object.geometry.attributes.normal.array].every(Number.isFinite)).toBe(true);
        expect([...object.geometry.attributes.uv.array].every(Number.isFinite)).toBe(true);
      });
      expect(draws).toBeLessThanOrEqual(8); expect(triangles).toBeGreaterThan(1500);
      expect(triangles).toBeLessThan(12500); expect(lights).toBe(0);
      expect(model.getObjectByName(lamp.mount === 'standing' ? 'lamp-base' : 'lamp-housing')).toBeDefined();
      expect(model.userData.lightEmitter.decay).toBe(2);
      expect(model.userData.lightEmitter.distance).toBeGreaterThan(lamp.dimensions.width * 2);
      model.dispose();
    });

    it(`${lamp.id} scales its shape and light in the same local coordinate system`, () => {
      const native = createShelfLamp({lampId:lamp.id});
      const fitted = createShelfLamp({lampId:lamp.id,width:lamp.dimensions.width / 2});
      const a = new THREE.Box3().setFromObject(native),b = new THREE.Box3().setFromObject(fitted);
      expect(b.min.distanceTo(a.min.multiplyScalar(.5))).toBeLessThan(.0001);
      expect(b.max.distanceTo(a.max.multiplyScalar(.5))).toBeLessThan(.0001);
      expect(fitted.scale.toArray()).toEqual([1,1,1]);
      expect(fitted.userData.lightEmitter.position).toEqual(native.userData.lightEmitter.position.map(value => value / 2));
      expect(fitted.userData.lightEmitter.distance).toBe(native.userData.lightEmitter.distance / 2);
      expect(fitted.userData.lightEmitter.intensity).toBeCloseTo(native.userData.lightEmitter.intensity / 4,6);
      fitted.position.set(100,200,300); fitted.updateMatrixWorld();
      const world = fitted.localToWorld(new THREE.Vector3(...fitted.userData.lightEmitter.position));
      expect(world.toArray()).toEqual(fitted.userData.lightEmitter.position.map((value,index) => value + [100,200,300][index]));
      native.dispose(); fitted.dispose();
    });

    it(`${lamp.id} releases all owned GPU resources exactly once`, () => {
      const model = createShelfLamp({lampId:lamp.id}),resources = new Set();
      model.traverse(object => {
        if (object.geometry) resources.add(object.geometry);
        if (!object.material) return;
        resources.add(object.material);
        for (const value of Object.values(object.material)) if (value?.isTexture) resources.add(value);
      });
      const dispose = [...resources].map(resource => vi.spyOn(resource,'dispose'));
      model.userData.dispose(); model.dispose();
      for (const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
    });
  }

  it('keeps the retro LED filaments visible through real refractive glass', () => {
    const model = createShelfLamp({lampId:'tarnaby'});
    const chimney = model.getObjectByName('clear-glass-chimney'),bulb = model.getObjectByName('amber-candle-led-bulb');
    expect(chimney.material.isMeshPhysicalMaterial).toBe(true);
    expect(chimney.material.transmission).toBeGreaterThan(0);
    expect(chimney.material.ior).toBeGreaterThan(1.4);
    expect(chimney.castShadow).toBe(false);
    expect(bulb.material.isMeshPhysicalMaterial).toBe(true);
    expect(bulb.material.transparent).toBe(true);
    expect(bulb.material.opacity).toBeGreaterThan(0);
    expect(bulb.material.opacity).toBeLessThan(1);
    expect(bulb.material.depthWrite).toBe(false);
    expect(bulb.material.color.r).toBeGreaterThan(bulb.material.color.b);
    expect(bulb.castShadow).toBe(false);
    const filaments = model.getObjectByName('glowing-retro-led-filaments');
    expect(filaments.material.emissiveIntensity).toBeGreaterThan(0);
    expect(filaments.material.emissive.r).toBeGreaterThan(filaments.material.emissive.g);
    expect(filaments.material.emissive.g).toBeGreaterThan(filaments.material.emissive.b);
    expect(filaments.material.toneMapped).toBe(true);
    expect(model.getObjectByName('brass-collar-and-machined-dimmer').material.metalness).toBe(1);
    model.dispose();
  });

  it('retains woven fabric and wood detail at zoom distances with mipmapped maps', () => {
    const model = createShelfLamp({lampId:'tripod'}),low = createShelfLamp({lampId:'tripod',quality:'low'});
    const linen = model.getObjectByName('woven-linen-drum-shade').material;
    const wood = model.getObjectByName('lamp-base').material;
    expect(linen.map.image.width).toBe(512); expect(wood.map.image.height).toBe(1024);
    expect(linen.map.generateMipmaps).toBe(true);
    expect(linen.map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(linen.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(linen.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(linen.emissiveMap).toBe(linen.map);
    expect(new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray())
      .toEqual(new THREE.Box3().setFromObject(low).getSize(new THREE.Vector3()).toArray());
    model.dispose(); low.dispose();
  });

  it('fits a low shelf without distorting the tabletop lamp proportions', () => {
    const model = createShelfLamp({lampId:'tripod',width:180,height:210});
    expect(model.userData.width).toBe(135); expect(model.userData.height).toBe(210);
    const bounds = new THREE.Box3().setFromObject(model);
    expect(bounds.max.y).toBe(210); expect(bounds.max.x - bounds.min.x).toBe(135);
    model.dispose();
  });

  it('lights a neighbouring shelf well before the smooth distance cutoff', () => {
    // Three's inverse-square attenuation and smooth cutoff, evaluated at a
    // 350 mm shelf span. Diffuser emission alone never illuminates a book.
    const irradiance = (emitter,distance) => emitter.intensity / distance ** emitter.decay *
      Math.max(0,1 - (distance / emitter.distance) ** 4) ** 2;
    for (const lamp of LAMP_CATALOG) {
      const native = createShelfLamp({lampId:lamp.id});
      const fitted = createShelfLamp({lampId:lamp.id,width:lamp.dimensions.width / 2});
      expect(irradiance(native.userData.lightEmitter,350)).toBeGreaterThan(1.35);
      expect(irradiance(fitted.userData.lightEmitter,175))
        .toBeCloseTo(irradiance(native.userData.lightEmitter,350),6);
      native.dispose(); fitted.dispose();
    }
  });

  it('lets the tripod cone leave its lower aperture without being blocked by its own support', () => {
    const model = createShelfLamp({lampId:'tripod'});
    model.updateMatrixWorld(true);
    const emitter = model.userData.lightEmitter;
    const ray = new THREE.Raycaster(new THREE.Vector3(...emitter.position),
      new THREE.Vector3(...emitter.direction),.01,emitter.position[1]);
    const opaqueCasters = [];
    model.traverse(object => { if (object.isMesh && object.castShadow) opaqueCasters.push(object); });
    expect(ray.intersectObjects(opaqueCasters,false)).toEqual([]);
    const glow = model.getObjectByName('woven-linen-drum-shade').material;
    expect(glow.emissiveIntensity).toBeLessThanOrEqual(1.2);
    model.dispose();
  });
});
