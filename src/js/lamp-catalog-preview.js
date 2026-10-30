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
      // Filtering, glass shadows, the fixture's own light, the stand, the camera and the centring:
      // rust-ui/src/studio_build.rs. A filament lamp's strips come from the shelf's light pool.
      const dressed = studio.shelf.studio_lamp_dress(THREE, host, model, display, presentation, camera, renderer, lamp, surfaces,
        () => { filamentLighting = createShelfLampLighting(studio.parts.scene, { maxLights:1, filamentAreas:true }); });
      if (dressed.fixture) fixture = dressed.fixture;
      if (dressed.target) target = dressed.target;
      size = dressed.size;
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
