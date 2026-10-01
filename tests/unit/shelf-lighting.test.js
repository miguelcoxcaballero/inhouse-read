import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShelfLighting, widePenumbra } from '../../src/js/shelf-lighting.js';

describe('visible shelf lighting', () => {
  it('fits a single bounded soft shadow to the visible rows and stays quiet at rest', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    scene.userData.readerLight = key; scene.add(key);
    const renderer = { shadowMap:{ needsUpdate:false } };
    const lighting = createShelfLighting(scene, renderer);
    const frame = { width:390, viewportHeight:700, scroll:0, depth:160, dirty:true };
    lighting.update(frame);
    expect(key.castShadow).toBe(true);
    expect(key.shadow.mapSize.toArray()).toEqual([1024,1024]);
    expect(key.shadow.autoUpdate).toBe(false);
    expect(key.shadow.camera.top).toBeLessThan(1000);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    renderer.shadowMap.needsUpdate = false; key.shadow.needsUpdate = false;
    lighting.update({ ...frame, dirty:false });
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    expect(key.shadow.needsUpdate).toBe(false);
    const previousY = key.target.position.y;
    lighting.update({ ...frame, scroll:500, dirty:false });
    expect(key.target.position.y).toBe(previousY - 500);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    key.shadow.map = { dispose:vi.fn() };
    lighting.dispose();
    expect(key.shadow.map.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the rig direction and tightens the frustum to the cabinet actually in view', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    key.position.set(-.46, .42, 1); scene.userData.readerLight = key; scene.add(key);
    const direction = key.position.clone().normalize();
    const renderer = { shadowMap:{ needsUpdate:false } };
    const lighting = createShelfLighting(scene, renderer);
    const frame = { width:1280, viewportHeight:860, scroll:300, depth:160 };
    lighting.update(frame);
    const wide = key.shadow.camera.right - key.shadow.camera.left;
    // A narrower cabinet, partly above the viewport: only its visible part counts.
    const bounds = new THREE.Box3(new THREE.Vector3(210, -2000, -170), new THREE.Vector3(1070, 0, 12));
    lighting.update({ ...frame, bounds });
    const camera = key.shadow.camera;
    expect(camera.right - camera.left).toBeLessThan(wide);
    expect(key.target.position.x).toBeCloseTo(640, 5);
    expect(key.target.position.y).toBeCloseTo(-300 - 430, 5);
    expect(key.position.clone().sub(key.target.position).normalize().distanceTo(direction)).toBeLessThan(1e-9);
    // The whole visible box sits inside the shadow frustum.
    key.updateMatrixWorld(); camera.position.copy(key.position); camera.lookAt(key.target.position); camera.updateMatrixWorld();
    // With room at each edge for the back panel's widest shadow taps.
    for (const x of [210, 1070]) for (const y of [-300, -1160]) for (const z of [-170, 12]) {
      const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      expect(point.x).toBeGreaterThan(camera.left + 40); expect(point.x).toBeLessThan(camera.right - 40);
      expect(point.y).toBeGreaterThan(camera.bottom + 40); expect(point.y).toBeLessThan(camera.top - 40);
      expect(-point.z).toBeGreaterThan(camera.near); expect(-point.z).toBeLessThan(camera.far);
    }
    lighting.dispose();
  });

  it('reuses the map for short scrolls and keeps the penumbra width constant on the shelf', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    key.position.set(-.46, .42, 1); scene.userData.readerLight = key; scene.add(key);
    const renderer = { shadowMap:{ needsUpdate:false } };
    const lighting = createShelfLighting(scene, renderer);
    const bounds = new THREE.Box3(new THREE.Vector3(210, -4000, -170), new THREE.Vector3(1070, 0, 12));
    const frame = { width:1280, viewportHeight:860, scroll:1000, depth:160, bounds, dirty:false };
    expect(lighting.update(frame)).toBe(true);
    const texelRadius = camera => key.shadow.radius * Math.max(camera.right - camera.left, camera.top - camera.bottom) / 1024;
    const penumbra = texelRadius(key.shadow.camera), target = key.target.position.clone();
    // Scrolling within the fitted slack neither moves the frustum nor redraws.
    for (const scroll of [1040, 1120, 960, 880]) {
      renderer.shadowMap.needsUpdate = key.shadow.needsUpdate = false;
      expect(lighting.update({ ...frame, scroll })).toBe(false);
      expect(renderer.shadowMap.needsUpdate).toBe(false);
      expect(key.target.position.equals(target)).toBe(true);
    }
    // Leaving it refits once, around the new window.
    expect(lighting.update({ ...frame, scroll:1300 })).toBe(true);
    expect(key.target.position.y).toBeCloseTo(-1300 - 430, 5);
    expect(lighting.update({ ...frame, scroll:1300 })).toBe(false);
    // Near the cabinet's top the clipped window is smaller, yet the blur
    // covers the same distance on the shelf.
    lighting.update({ ...frame, scroll:0 });
    expect(key.shadow.camera.top - key.shadow.camera.bottom).toBeLessThan(target.y * -2);
    expect(texelRadius(key.shadow.camera)).toBeCloseTo(penumbra, 5);
    // A change to the scene still redraws without a refit.
    expect(lighting.update({ ...frame, scroll:0, dirty:true })).toBe(true);
    lighting.dispose();
  });

  it('blurs a moving map with half the taps and redraws it once at full quality when the scene settles', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    scene.userData.readerLight = key; scene.add(key);
    const renderer = { shadowMap:{ needsUpdate:false } };
    const lighting = createShelfLighting(scene, renderer);
    const frame = { width:390, viewportHeight:700, scroll:0, depth:160, dirty:false };
    expect(lighting.update({ ...frame, dirty:true })).toBe(true);
    const full = key.shadow.blurSamples;
    expect(full).toBeGreaterThanOrEqual(8); expect(lighting.settling).toBe(false);
    for (let frameIndex = 0; frameIndex < 3; frameIndex++) {
      expect(lighting.update({ ...frame, dirty:true, moving:true })).toBe(true);
      expect(key.shadow.blurSamples).toBe(full / 2); expect(lighting.settling).toBe(true);
    }
    // The first still frame redraws although nothing else changed, then rests.
    renderer.shadowMap.needsUpdate = key.shadow.needsUpdate = false;
    expect(lighting.update(frame)).toBe(true);
    expect(renderer.shadowMap.needsUpdate).toBe(true); expect(key.shadow.needsUpdate).toBe(true);
    expect(key.shadow.blurSamples).toBe(full); expect(lighting.settling).toBe(false);
    renderer.shadowMap.needsUpdate = key.shadow.needsUpdate = false;
    expect(lighting.update(frame)).toBe(false);
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    // An ordinary change at rest keeps full quality.
    expect(lighting.update({ ...frame, dirty:true })).toBe(true);
    expect(key.shadow.blurSamples).toBe(full); expect(lighting.settling).toBe(false);
    lighting.dispose();
  });

  it('reuses exact shadow coordinates through finger zoom and pan, and redraws real geometry or daylight turns', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    key.position.set(-.46, .42, 1); scene.userData.readerLight = key; scene.add(key);
    const renderer = { shadowMap:{ needsUpdate:false } }, lighting = createShelfLighting(scene, renderer);
    const cabinet = new THREE.Box3(new THREE.Vector3(0, -650, -160), new THREE.Vector3(390, 0, 0));
    const frame = { width:390, viewportHeight:700, scroll:0, depth:160, dirty:false };
    const transform = new THREE.Matrix4();
    expect(lighting.update({ ...frame, bounds:cabinet, transform })).toBe(true);
    // Simulate the initial map being drawn by three, then follow one receiver.
    key.shadow.updateMatrices(key); key.shadow.needsUpdate = renderer.shadowMap.needsUpdate = false;
    const receiver = new THREE.Vector3(150, -220, -80), projected = receiver.clone().applyMatrix4(key.shadow.matrix);
    const direction = key.position.clone().sub(key.target.position).normalize();
    let redraws = 0;
    for (let index = 1; index <= 60; index++) {
      const zoom = 1 + index / 30;
      transform.makeScale(zoom, zoom, zoom).setPosition((1 - zoom) * 195 + index / 3, (zoom - 1) * 350, 0);
      redraws += Number(lighting.update({ ...frame, bounds:cabinet.clone().applyMatrix4(transform), transform, moving:true }));
      const current = receiver.clone().applyMatrix4(transform).applyMatrix4(key.shadow.matrix);
      expect(current.distanceTo(projected)).toBeLessThan(1e-7);
      expect(key.position.clone().sub(key.target.position).normalize().distanceTo(direction)).toBeLessThan(1e-7);
      expect(key.shadow.needsUpdate).toBe(false);
    }
    expect(redraws).toBe(0); expect(renderer.shadowMap.needsUpdate).toBe(false);
    expect(lighting.update({ ...frame, bounds:cabinet.clone().applyMatrix4(transform), transform })).toBe(false);
    // At gesture end one fresh visible-window fit restores the original
    // resolution and screen-space softness, rather than magnifying the map.
    const finalBounds = cabinet.clone().applyMatrix4(transform);
    expect(lighting.update({ ...frame, bounds:finalBounds, transform, forceRefit:true })).toBe(true);
    expect(key.shadow.normalBias).toBe(.45); expect(lighting.settling).toBe(false);
    const referenceScene = new THREE.Scene(), referenceKey = new THREE.DirectionalLight();
    referenceKey.position.set(-.46, .42, 1); referenceScene.userData.readerLight = referenceKey; referenceScene.add(referenceKey);
    const reference = createShelfLighting(referenceScene, { shadowMap:{} });
    reference.update({ ...frame, bounds:finalBounds, transform });
    for (const axis of ['left', 'right', 'top', 'bottom', 'near', 'far']) {
      expect(key.shadow.camera[axis]).toBeCloseTo(referenceKey.shadow.camera[axis], 7);
    }
    expect(key.shadow.radius).toBeCloseTo(referenceKey.shadow.radius, 7);
    expect(key.shadow.blurSamples).toBe(referenceKey.shadow.blurSamples);
    expect(key.position.distanceTo(referenceKey.position)).toBeLessThan(1e-7);
    key.shadow.needsUpdate = renderer.shadowMap.needsUpdate = false;
    expect(lighting.update({ ...frame, bounds:finalBounds, transform })).toBe(false);
    expect(key.shadow.needsUpdate).toBe(false); reference.dispose();
    // Books moving inside the room change occlusion and still redraw at full quality.
    expect(lighting.update({ ...frame, bounds:cabinet.clone().applyMatrix4(transform), transform, dirty:true })).toBe(true);
    key.shadow.needsUpdate = renderer.shadowMap.needsUpdate = false;
    const pivot = new THREE.Vector3(195, -325, -80);
    const turn = angle => transform.makeTranslation(...pivot.toArray()).multiply(new THREE.Matrix4().makeRotationY(angle))
      .multiply(new THREE.Matrix4().makeTranslation(...pivot.clone().negate().toArray()));
    turn(-.3);
    expect(lighting.update({ ...frame, bounds:cabinet.clone().applyMatrix4(transform), transform })).toBe(true);
    expect(key.shadow.needsUpdate).toBe(true);
    key.shadow.needsUpdate = false;
    // Mirrored yaw angles have equal axis-aligned bounds but different occlusion.
    turn(.3);
    expect(lighting.update({ ...frame, bounds:cabinet.clone().applyMatrix4(transform), transform })).toBe(true);
    expect(key.shadow.needsUpdate).toBe(true);
    lighting.dispose();
  });

  it('widens only the back panel shadow along its own surface and dims its room bounce', () => {
    const panel = widePenumbra(new THREE.MeshStandardMaterial());
    const shader = { fragmentShader:THREE.ShaderLib.standard.fragmentShader };
    panel.onBeforeCompile(shader);
    const source = shader.fragmentShader;
    expect(source).toContain('float getPanelShadow(');
    expect(source).toContain('getPanelShadow( directionalShadowMap[ i ]');
    expect(source).not.toContain('getShadow( directionalShadowMap[ i ]');
    expect(source).toContain('dFdx( coord.xyz )');
    expect(source).toMatch(/indirectDiffuse \*= \.8;/);
    expect(panel.defines.PANEL_TAPS).toBeGreaterThanOrEqual(8);
    // Its own program: no other standard material inherits the patch.
    expect(panel.customProgramCacheKey()).not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
  });

  it('hands the panel its disk taps as constants, the same Vogel pattern whatever the screen', () => {
    for (const [width, taps] of [[390, 9], [1280, 12]]) {
      vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', 900);
      const panel = widePenumbra(new THREE.MeshStandardMaterial());
      const shader = { fragmentShader:THREE.ShaderLib.standard.fragmentShader };
      panel.onBeforeCompile(shader);
      expect(panel.defines.PANEL_TAPS).toBe(taps);
      const source = shader.fragmentShader, start = source.indexOf('float getPanelShadow('), body = source.slice(start, source.indexOf('#endif', start));
      expect(body).not.toMatch(/\b(cos|sin|sqrt)\(|for \(/);
      const offsets = [...body.matchAll(/vec4\( (-?[\d.]+) \* du \+ (-?[\d.]+) \* dv, 0\.0 \)/g)];
      expect(offsets).toHaveLength(taps);
      offsets.forEach(([, along, across], k) => {
        const radius = Math.sqrt((k + .5) / taps), angle = k * 2.39996 + .4;
        expect(Number(along)).toBeCloseTo(radius * Math.cos(angle), 7);
        expect(Number(across)).toBeCloseTo(radius * Math.sin(angle), 7);
      });
    }
    vi.unstubAllGlobals();
  });

  it('notices every layout input that changes and ignores sub-hundredth jitter', () => {
    const scene = new THREE.Scene(), key = new THREE.DirectionalLight();
    key.position.set(-.46, .42, 1); scene.userData.readerLight = key; scene.add(key);
    const lighting = createShelfLighting(scene, { shadowMap:{} });
    const bounds = new THREE.Box3(new THREE.Vector3(210, -4000, -170), new THREE.Vector3(1070, 0, 12));
    const frame = { width:1280, viewportHeight:860, scroll:1000, depth:160, bounds, dirty:false };
    expect(lighting.update(frame)).toBe(true);
    expect(lighting.update({ ...frame, bounds:bounds.clone() })).toBe(false);
    // Below the two decimals a layout is compared at: still the same layout.
    expect(lighting.update({ ...frame, width:1280.001 })).toBe(false);
    const changes = [{ width:1300 }, { viewportHeight:900 }, { depth:200 },
      { bounds:bounds.clone().set(bounds.min, bounds.max.clone().setZ(60)) },
      { bounds:bounds.clone().set(bounds.min.clone().setX(250), bounds.max) },
      { bounds:null }, { bounds }];
    for (const change of changes) {
      const next = { ...frame, ...change };
      expect(lighting.update(next)).toBe(true);
      expect(lighting.update({ ...next })).toBe(false);
      frame.width = next.width; frame.viewportHeight = next.viewportHeight; frame.depth = next.depth; frame.bounds = next.bounds;
    }
    lighting.dispose();
  });

  it('firms up the variance shadow light-bleed floor once and does nothing without a key light', () => {
    const empty = createShelfLighting(new THREE.Scene(), { shadowMap:{} });
    expect(() => { empty.update({ width:1, viewportHeight:1, scroll:0, depth:1 }); empty.dispose(); }).not.toThrow();
    expect(empty.settling).toBe(false);
    const scene = new THREE.Scene(); scene.userData.readerLight = new THREE.DirectionalLight();
    createShelfLighting(scene, { shadowMap:{} }); createShelfLighting(scene, { shadowMap:{} });
    const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
    expect(chunk).not.toContain('( softness_probability - 0.3 )');
    expect(chunk.match(/softness_probability - 0\.62/g)).toHaveLength(1);
  });
});
