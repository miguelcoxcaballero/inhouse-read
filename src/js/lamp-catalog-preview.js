import * as THREE from 'three';
import { createShelfLamp } from './shelf-lamps.js';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { createShelfLampLighting, ensureAreaLights } from './shelf-lamp-lighting.js';
import { DEFAULT_LAMP_KELVIN, createTintTransition, tintColor } from './lamp-kelvin.js';
import { openStudio, studioControls, LAMP_STUDIO } from './catalog-studio.js';

// The filament lamp's light needs its lookup tables before the first preview.
await ensureAreaLights().catch(() => {});

/** The actual shelf lamp, with its own warm light and reflected studio lighting.
 * The chosen lamp is built after its button has painted; until its shaders are linked (in parallel) the
 * canvas keeps showing the previous picture. The light's colour temperature eases in ~300 ms; only colours
 * change. When to build, show, retint or draw, the studio's lights and the lamp's stand are decided in Rust
 * (rust-ui/src/catalog_studio.rs). */
export function createLampCatalogPreview(host) {
  let fixture, target, filamentLighting, display, presentation;
  const tint = createTintTransition(DEFAULT_LAMP_KELVIN);
  let shownTint = '';
  const surfaces = [];
  let size = new THREE.Vector3(180,280,180);
  const filaments = model => filamentLighting?.update([{ kind:'lamp',key:'catalog-filaments',model,width:size.x }]);
  function applyTint(model) {
    shownTint = tint.state.value.join();
    model.userData.setTint(tint.state.value);
    if (fixture) tintColor(fixture.color.set(model.userData.lightEmitter.color),tint.state.value);
  }
  function removeModel(model) {
    filamentLighting?.dispose(); filamentLighting = null;
    if (model) {
      display.remove(model);
      (model.dispose || model.userData.dispose)?.();
    }
    if (fixture) { display.remove(fixture); fixture.dispose(); fixture = null; }
    if (target) { display.remove(target); target = null; }
    presentation.clear();
    for (const mesh of surfaces.splice(0)) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }
  const studio = openStudio(LAMP_STUDIO, host, {
    padding:1.13,
    prepareScene({ scene }) {
      display = new THREE.Group(); scene.add(display);
      presentation = new THREE.Group(); display.add(presentation);
    },
    make(lamp, _stage, previous, invalidate) {
      const { renderer, camera } = studio.parts;
      removeModel(previous); display.position.set(0,0,0);
      renderer.shadowMap.needsUpdate = true;
      const model = createShelfLamp({ lampId:lamp.id,width:lamp.dimensions.width,quality:'high',kelvin:tint.state.kelvin });
      shownTint = '';
      model.userData.invalidate = invalidate;
      model.traverse(object => {
        if (!object.isMesh) return;
        // Glass keeps the model's transparent shadow behaviour, so the
        // chimney cannot cast an opaque silhouette over its own LED filament.
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        if (objectMaterials.some(material => material.transparent || material.transmission > 0)) object.castShadow = false;
        for (const material of objectMaterials) {
          for (const name of ['map','bumpMap','roughnessMap']) {
            if (material[name]) material[name].anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
          }
        }
      });
      display.add(model);
      const emitter = model.userData.lightEmitter;
      const stage = studio.shelf.studio_lamp_stage(lamp.mount === 'undershelf', lamp.dimensions.width);
      if (emitter?.filaments) {
        emitter.intensity *= stage.filament;
        filamentLighting = createShelfLampLighting(studio.parts.scene, { maxLights:1, filamentAreas:true });
      } else if (emitter) {
        fixture = emitter.direction
          ? new THREE.SpotLight(emitter.color,emitter.intensity * stage.cone,emitter.distance,emitter.angle,emitter.penumbra,emitter.decay)
          : new THREE.PointLight(emitter.color,emitter.intensity * stage.bulb,emitter.distance,emitter.decay);
        fixture.position.fromArray(emitter.position); display.add(fixture);
        if (emitter.direction) {
          target = new THREE.Object3D(); target.position.copy(fixture.position).add(new THREE.Vector3().fromArray(emitter.direction));
          display.add(target); fixture.target = target;
        }
      }
      for (const { kind, size:[a, b, c], color, y, cast } of stage.surfaces) {
        const mesh = new THREE.Mesh(kind === 'box' ? new THREE.BoxGeometry(a, b, c) : new THREE.CircleGeometry(a, b),
          new THREE.MeshStandardMaterial({ color, roughness:.86 }));
        mesh.receiveShadow = true; surfaces.push(mesh); presentation.add(mesh);
        if (kind === 'circle') mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = y;
        if (cast) mesh.castShadow = true;
      }
      camera.position.set(...stage.camera);
      const bounds = new THREE.Box3().setFromObject(display);
      size = bounds.getSize(new THREE.Vector3()); display.position.sub(bounds.getCenter(new THREE.Vector3()));
      camera.lookAt(0,0,0);
      host.dataset.lightEmitter = emitter ? 'warm-physical' : 'none';
      // Its light must exist before linking: every lit program depends on it.
      display.updateMatrixWorld(true);
      applyTint(model);
      filaments(model);
      return model;
    },
    linkRoot:() => display,
    // 1: still easing; 2: a new tint was applied.
    retint(now) {
      const model = studio.state.model, tinting = tint.advance(now);
      if (tint.state.value.join() === shownTint) return tinting ? 1 : 0;
      applyTint(model);
      return (tinting ? 1 : 0) | 2;
    },
    tintSet:(kelvin, now, animate) => tint.set(kelvin, now, animate),
    size:() => size,
    beforeDraw:filaments,
    release(model, { scene }) {
      removeModel(model);
      scene.traverse(object => { if (object.isLight) object.dispose(); });
    }
  });
  const { state, shelf } = studio;
  return studioControls(studio, ({ lampId,kelvin = DEFAULT_LAMP_KELVIN }) => {
    const lamp = getCatalogLamp(lampId);
    if (lamp) shelf.studio_update_lamp(state, lamp, kelvin);
  });
}
