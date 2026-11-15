import * as THREE from 'three';
import { createShelfLamp } from './shelf-lamps.js';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { createShelfLampLighting, ensureAreaLights } from './shelf-lamp-lighting.js';
import { DEFAULT_LAMP_KELVIN, LAMP_KELVINS, LAMP_KELVIN_MS, lampTint } from './lamp-kelvin.js';
import { openStudio, studioControls, LAMP_STUDIO } from './catalog-studio.js';

// The filament lamp's light needs its lookup tables before the first preview.
await ensureAreaLights().catch(() => {});

/** The actual shelf lamp, with its own warm light and reflected studio lighting.
 * The chosen lamp is built after its button has painted; until its shaders are linked (in parallel) the
 * canvas keeps showing the previous picture. The light's colour temperature eases in ~300 ms; only colours
 * change. All of it is decided and done in Rust (rust-ui/src/catalog_studio.rs, catalog_lamp.rs,
 * studio_tint.rs) on the record given here. What stays: the lamp's builder, the filament lamp's area lights
 * and writing a tint on the model and its light. */
export function createLampCatalogPreview(host) {
  const studio = openStudio(LAMP_STUDIO, host, { padding:1.13, lamp:{
    three:THREE, host, createShelfLamp, createShelfLampLighting, ms:LAMP_KELVIN_MS,
    tints:[DEFAULT_LAMP_KELVIN, ...LAMP_KELVINS.flatMap(kelvin => [kelvin, ...lampTint(kelvin)])],
    display:null, presentation:null, fixture:null, target:null, surfaces:[],
    tintLamp(model, r, g, b) {
      model.userData.setTint([r, g, b]);
      if (this.fixture) {
        const color = this.fixture.color.set(model.userData.lightEmitter.color);
        color.r *= r; color.g *= g; color.b *= b;
      }
    }
  } });
  const { state, shelf } = studio;
  return studioControls(studio, ({ lampId,kelvin = DEFAULT_LAMP_KELVIN }) => {
    const lamp = getCatalogLamp(lampId);
    if (lamp) shelf.studio_update_lamp(state, lamp, kelvin);
  });
}
