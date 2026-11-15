import * as THREE from 'three';
import { createShelfLamp } from './shelf-lamps.js';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { createShelfLampLighting, ensureAreaLights } from './shelf-lamp-lighting.js';
import { DEFAULT_LAMP_KELVIN, LAMP_KELVINS, LAMP_KELVIN_MS, lampTint } from './lamp-kelvin.js';
import { openStudio, studioControls, LAMP_STUDIO } from './catalog-studio.js';
import { needRustShelf } from './rust-shelf.js';

// The filament lamp's light needs its lookup tables before the first preview.
await ensureAreaLights().catch(() => {});

/** The actual shelf lamp, with its own warm light and reflected studio lighting.
 * The chosen lamp is built after its button has painted; until its shaders are linked (in parallel) the
 * canvas keeps showing the previous picture. The light's colour temperature eases in ~300 ms; only colours
 * change. When to build, show, retint or draw, the studio's lights and the lamp's stand are decided in Rust
 * (rust-ui/src/catalog_studio.rs), which also sets the chosen lamp up: its glass and textures, its own light,
 * the stand, the camera and the centring (rust-ui/src/catalog_lamp.rs), on `rig`, and eases the tint
 * (rust-ui/src/studio_tint.rs). The lamp's builder, the filament lamp's area lights and applying a tint to
 * the model and its light stay here. */
export function createLampCatalogPreview(host) {
  const native = needRustShelf();
  let filamentLighting;
  // The transition's numbers (studio_tint.rs: 0 the temperature, 7-9 the tint, 12-14 the one applied, 15 none
  // yet, 17 a frame has something to do).
  const tint = new Float64Array(18), tints = [DEFAULT_LAMP_KELVIN, ...LAMP_KELVINS.flatMap(kelvin => [kelvin, ...lampTint(kelvin)])];
  const tintSet = (kelvin, now, animate) => native.studio_tint_set(tint, tints, LAMP_KELVIN_MS, Number(kelvin), now, animate);
  tintSet(DEFAULT_LAMP_KELVIN, 0, false);
  const rig = { display:null, presentation:null, fixture:null, target:null, surfaces:[], size:new THREE.Vector3(180,280,180) };
  const filaments = model => filamentLighting?.update([{ kind:'lamp',key:'catalog-filaments',model,width:rig.size.x }]);
  function applyTint(model) {
    const value = [tint[7], tint[8], tint[9]];
    tint.copyWithin(12, 7, 10); tint[15] = 0;
    model.userData.setTint(value);
    if (rig.fixture) {
      const color = rig.fixture.color.set(model.userData.lightEmitter.color);
      color.r *= value[0]; color.g *= value[1]; color.b *= value[2];
    }
  }
  // What the set-up asks of this side, in its own order.
  const own = {
    three:THREE, host,
    unlight() { filamentLighting?.dispose(); filamentLighting = null; },
    create(lamp) {
      const model = createShelfLamp({ lampId:lamp.id,width:lamp.dimensions.width,quality:'high',kelvin:tint[0] });
      tint[15] = tint[17] = 1;
      return model;
    },
    light() { filamentLighting = createShelfLampLighting(studio.parts.scene, { maxLights:1, filamentAreas:true }); }
  };
  const studio = openStudio(LAMP_STUDIO, host, {
    padding:1.13,
    prepareScene:({ scene }) => native.studio_lamp_scene(rig, THREE, scene),
    make(lamp, _stage, previous, invalidate) {
      const model = native.studio_lamp_make(rig, own, studio.parts, lamp, previous, invalidate);
      applyTint(model);
      filaments(model);
      return model;
    },
    linkRoot:() => rig.display,
    // 1: still easing; 2: a new tint was applied.
    retint(now) {
      const code = tint[17] && native.studio_tint_step(tint, now);
      if (code & 2) applyTint(studio.state.model);
      return code;
    },
    tintSet,
    size:() => rig.size,
    beforeDraw:filaments,
    release:(model, { scene }) => native.studio_lamp_release(rig, own, model, scene)
  });
  const { state, shelf } = studio;
  return studioControls(studio, ({ lampId,kelvin = DEFAULT_LAMP_KELVIN }) => {
    const lamp = getCatalogLamp(lampId);
    if (lamp) shelf.studio_update_lamp(state, lamp, kelvin);
  });
}
