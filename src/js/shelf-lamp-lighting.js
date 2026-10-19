import * as THREE from 'three';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { needRustShelf } from './rust-shelf.js';

// Every lamp a library holds gets its own light up to this many: a lamp
// that glows lights the room, whatever the camera or the other lamps do.
export const MAX_SHELF_LAMP_LIGHTS = 8;
const MAX_LAMP_SHADOWS = 2;
// Rust owns fixture quotas, assignment/rank caches, light math, colour caches and shadow
// invalidation/transport state (lamp_light.rs). The host owns Three lights/scene graph,
// marshals emitter/model data and applies the returned light values and shadow commands.
const rootOut = new Float64Array(17);
const lightIn = new Float64Array(103), lightOut = new Float64Array(38);
let filamentIn = new Float64Array(24 + 10 * 4), filamentOut = new Float64Array(3 + 10 * 4);
const refused = what => new Error(`Las luces de las lámparas no recibieron datos válidos (${what}).`);
// The area-light lookup tables are ~250 KB of numbers that only the filament
// lamp needs, so they are a separate chunk loaded when a filament lamp is on the
// shelf (known from the saved lamps before the scene is built) or when the
// catalogue opens, never for the rest of the shelves.
let areaLights = null, areaLightsLoading = null;
export function ensureAreaLights() {
  return areaLightsLoading ||= import('three/addons/lights/RectAreaLightUniformsLib.js').then(({ RectAreaLightUniformsLib }) => {
    RectAreaLightUniformsLib.init(); areaLights = RectAreaLightUniformsLib; return areaLights;
  }).catch(error => { areaLightsLoading = null; throw error; });
}
export function savedLampsNeedAreaLights() {
  try { return /"lampId"\s*:\s*"tarnaby"/.test(localStorage.getItem('inhouse-read-shelf-lamps') || ''); } catch { return false; }
}
// The shelf lights filament lamps with a point light (see lampKind): only the
// catalogue's studio needs the area-light tables, and loads them itself.

// Reused every frame; emptied before returning so no entry is retained.
const candidates = [];
const FILAMENT_KINDS = [];
const filamentKind = count => FILAMENT_KINDS[count] ||= `filaments:${count}`;
// Which lights a lamp needs. A culled model is known from the catalogue, so
// scrolling a lamp out of the pool's reach never changes the set of lights.
// On the shelf a filament lamp is one point light of the same flux: its four
// area emitters (an LTC integral each, per pixel) cost more than every other
// light of a room together, and a phone could not draw the room at its
// refresh rate. The catalogue's single studio lamp keeps the four strips.
function lampKind(entry, filamentAreas = false) {
  const emitter = entry.model?.userData.lightEmitter;
  if (emitter) return emitter.filaments?.length ? filamentAreas ? filamentKind(emitter.filaments.length) : 'point' :
    Array.isArray(emitter.direction) ? 'cone' : 'point';
  const light = getCatalogLamp(entry.lampId)?.light ?? null;
  return !filamentAreas && light?.startsWith('filaments:') ? 'point' : light;
}
const isCandidate = entry => entry.kind === 'lamp' && entry.model?.visible &&
  entry.model.userData.lightEmitter && !entry.node?.classList.contains('is-away') && !entry.trashDrop;

/** Warm fixtures light the actual shelf materials. A small shared budget avoids
 * an ever-growing shader when a library has many decorated rows. Circular
 * under-shelf fixtures use downward cones; exposed bulbs radiate all around.
 * Filament lamps use four narrow area emitters, never a central point source.
 * Only two cones cast shadows, avoiding six shadow passes per exposed bulb.
 *
 * three recompiles every program of the room whenever the number of lights
 * or of shadow casters changes, which froze the app on each switch. The
 * lights are therefore a pool sized by the lamps the library owns, not by the
 * ones lit right now: switching, fading or scrolling a lamp only re-aims a
 * slot and sets its intensity (zero when unlit). The pool, and each cone's
 * shadow flag, change only with the library's lamps. A lamp switched off
 * keeps its slot until another lamp needs it, so its cached cone shadow is
 * still valid when it is switched on again.
 *
 * Only with more lamps than lights: the picked lamp keeps its light while
 * moving, then the lamps already lit keep theirs (a scroll or a drag never
 * moves a light to another lamp), then the ones nearest the camera centre,
 * with a stable key resolving equal scores.
 */
export function createShelfLampLighting(scene, { maxLights = MAX_SHELF_LAMP_LIGHTS, onAreaLightsReady, filamentAreas = false } = {}) {
  const kindOf = entry => lampKind(entry, filamentAreas);
  const slots = [];
  let pool = null;
  const poolState = () => pool ||= new (needRustShelf().LampPoolState)();
  const kindCode = kind => kind === 'cone' ? 0 : kind === 'point' ? 1 : Number(kind.slice(10)) + 1;
  const kindName = code => code === 0 ? 'cone' : code === 1 ? 'point' : filamentKind(code - 1);
  // Per-instance protocol state: the packed candidates and slots, the quotas, and what makes the ids of the keys.
  let kindsIn = new Float64Array(0), poolSlots = new Float64Array(0);
  let candidateIn = new Float64Array(0), slotIn = new Float64Array(0), planOut = new Float64Array(2);
  const keyIds = new Map(), identities = new Map();
  let nextKeyId = 0;
  // Rust invalidates ranks; locale-specific String collation is a browser primitive.
  let disposed = false, shadowRefresh = false, prepared = false;
  function removeLights(slot) {
    slot.state.free();
    for (const light of slot.lights) {
      light.removeFromParent(); light.target?.removeFromParent();
      light.shadow?.map?.dispose(); light.shadow?.mapPass?.dispose();
    }
  }
  function createSlot(kind, index) {
    const filaments = kind.startsWith('filaments:') ? Number(kind.slice(10)) : 0, spotlight = kind === 'cone';
    // Not loaded yet (a lamp added in a way the saved list did not announce):
    // the slot is created on the update after the tables arrive.
    if (filaments && !areaLights) {
      ensureAreaLights().then(() => { if (!disposed) onAreaLightsReady?.(); }).catch(error => console.warn('No se pudo cargar la luz de filamentos:', error));
      return false;
    }
    const slot = { kind, filaments, spotlight, shadow:spotlight && index < MAX_LAMP_SHADOWS, key:null,
      power:0, lit:false, state:new (needRustShelf().LampLightState)(filaments) };
    if (filaments) {
      slot.lights = Array.from({ length:filaments }, (_, strip) => {
        const light = new THREE.RectAreaLight(0xffffff, 0);
        light.userData.filamentIndex = strip;
        return light;
      });
    } else {
      const light = spotlight ? new THREE.SpotLight() : new THREE.PointLight();
      light.intensity = 0;
      if (spotlight) {
        light.castShadow = slot.shadow;
        light.shadow.mapSize.set(512, 512); light.shadow.autoUpdate = false;
        light.shadow.radius = 2; light.shadow.blurSamples = 4;
        light.shadow.bias = -.0002; light.shadow.intensity = .8;
        scene.add(light.target);
      }
      slot.lights = [light];
    }
    for (const light of slot.lights) { light.userData.shelfLamp = true; light.name = 'Shelf lamp light: idle'; scene.add(light); }
    slots.push(slot);
  }
  // Giving a slot to another lamp invalidates everything it remembers.
  function assign(slot, key) {
    slot.key = key; slot.state.assign();
    for (const light of slot.lights) { light.userData.entryKey = key; light.name = `Shelf lamp light: ${key}`; }
  }
  function release(slot) {
    slot.key = null; slot.power = 0; slot.lit = false;
    for (const light of slot.lights) { light.intensity = 0; light.userData.entryKey = null; light.name = 'Shelf lamp light: idle'; }
  }
  // Every kind of lamp the library owns gets one slot before any gets a
  // second, in a fixed order: the pool never depends on the entries' order.
  function reconcile(entries) {
    if (kindsIn.length !== entries.length) kindsIn = new Float64Array(entries.length);
    if (poolSlots.length !== slots.length) poolSlots = new Float64Array(slots.length);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], kind = entry.kind === 'lamp' ? kindOf(entry) : null;
      kindsIn[index] = kind ? kindCode(kind) : -1;
    }
    for (let index = 0; index < slots.length; index++) poolSlots[index] = kindCode(slots[index].kind);
    const poolOut = poolState().reconcile(kindsIn, poolSlots, Number(maxLights));
    let changed = false;
    for (let at = 0; at < poolOut.length; at += 3) {
      const kind = kindName(poolOut[at]), want = poolOut[at + 1];
      let have = poolOut[at + 2];
      for (; have < want; have++) { if (createSlot(kind, have) === false) break; changed = true; }
      for (; have > want; have--) {
        const at = slots.findLastIndex(slot => slot.kind === kind);
        removeLights(slots[at]); slots.splice(at, 1); changed = true;
      }
    }
    return changed;
  }
  const idOf = key => { let id = keyIds.get(key); if (id === undefined) keyIds.set(key, id = nextKeyId++); return id; };
  function rankKeys() {
    const count = candidates.length, order = Array.from({ length:count }, (_, index) => index);
    order.sort((a, b) => String(candidates[a].key).localeCompare(String(candidates[b].key)));
    const ranks = new Float64Array(count);
    order.forEach((index, rank) => { ranks[index] = rank; });
    return ranks;
  }
  function updateFilaments(slot, entry, wasLit) {
    const model = entry.model, emitter = model.userData.lightEmitter, count = slot.lights.length;
    model.updateWorldMatrix(true, false);
    if (filamentIn.length < 24 + 10 * count) filamentIn = new Float64Array(24 + 10 * count);
    if (filamentOut.length < 3 + 10 * count) filamentOut = new Float64Array(3 + 10 * count);
    filamentIn.set(model.matrixWorld.elements, 0);
    filamentIn[16] = count; filamentIn[17] = Math.floor(emitter.color ?? 0xffd19a) | 0;
    const tint = emitter.tint;
    filamentIn[18] = tint ? 1 : 0;
    if (tint) { filamentIn[19] = tint[0]; filamentIn[20] = tint[1]; filamentIn[21] = tint[2]; }
    filamentIn[22] = Number(emitter.intensity); filamentIn[23] = slot.power;
    for (let index = 0; index < count; index++) {
      const strip = emitter.filaments[index], at = 24 + 10 * index;
      filamentIn[at] = strip.start[0]; filamentIn[at + 1] = strip.start[1]; filamentIn[at + 2] = strip.start[2];
      filamentIn[at + 3] = strip.end[0]; filamentIn[at + 4] = strip.end[1]; filamentIn[at + 5] = strip.end[2];
      filamentIn[at + 6] = strip.normal[0]; filamentIn[at + 7] = strip.normal[1]; filamentIn[at + 8] = strip.normal[2];
      filamentIn[at + 9] = strip.width;
    }
    const flags = slot.state.filaments(slot.lit, wasLit, filamentIn, filamentOut);
    if (!(flags & 8)) throw refused('filamentos');
    const out = filamentOut;
    for (let index = 0; index < count; index++) {
      const light = slot.lights[index], at = 3 + 10 * index;
      // RectAreaLight emits towards local -Z: each strip lies along its actual LED fibre and faces out through the glass.
      light.quaternion.set(out[at + 3], out[at + 4], out[at + 5], out[at + 6]);
      light.position.set(out[at], out[at + 1], out[at + 2]);
      light.width = out[at + 7]; light.height = out[at + 8];
      light.color.r = out[0]; light.color.g = out[1]; light.color.b = out[2];
      light.intensity = out[at + 9];
      light.updateMatrixWorld(true);
    }
    return (flags & 1) !== 0;
  }
  // rootMatrix: the room's transform when the lights can follow it, else null.
  function updateLight(slot, entry, wasLit, shadowDirty, rootMatrix) {
    const model = entry.model, emitter = model.userData.lightEmitter, light = slot.lights[0];
    const { spotlight, shadow:shadowed } = slot;
    model.updateWorldMatrix(true, false);
    lightIn.set(model.matrixWorld.elements, 0);
    lightIn[16] = rootMatrix ? 1 : 0; lightIn[81] = 0;
    if (rootMatrix) {
      for (let index = 0; index < 16; index++) lightIn[17 + index] = rootOut[1 + index];
      lightIn.set(rootMatrix.elements, 33);
    }
    lightIn[82] = emitter.position[0]; lightIn[83] = emitter.position[1]; lightIn[84] = emitter.position[2];
    if (spotlight) { lightIn[85] = emitter.direction[0]; lightIn[86] = emitter.direction[1]; lightIn[87] = emitter.direction[2]; }
    lightIn[88] = Math.floor(emitter.color ?? 0xffd19a) | 0;
    const tint = emitter.tint;
    lightIn[89] = tint ? 1 : 0;
    if (tint) { lightIn[90] = tint[0]; lightIn[91] = tint[1]; lightIn[92] = tint[2]; }
    lightIn[93] = Number(emitter.intensity); lightIn[94] = slot.power; lightIn[95] = Number(emitter.distance);
    lightIn[96] = Number(entry.width); lightIn[97] = Number(emitter.decay);
    lightIn[98] = emitter.angle == null ? 0 : 1; lightIn[99] = emitter.angle;
    lightIn[100] = emitter.penumbra == null ? 0 : 1; lightIn[101] = emitter.penumbra;
    // Raw non-number emitter values compared unequal to Float64 stamps even
    // when their numeric conversion was unchanged (including undefined).
    lightIn[102] = typeof emitter.distance !== 'number' ||
      typeof emitter.position[0] !== 'number' || typeof emitter.position[1] !== 'number' || typeof emitter.position[2] !== 'number' ||
      (spotlight && (typeof emitter.direction[0] !== 'number' || typeof emitter.direction[1] !== 'number' || typeof emitter.direction[2] !== 'number')) ? 1 : 0;
    const flags = slot.state.light(spotlight, shadowed, slot.lit, wasLit, shadowDirty, lightIn, lightOut);
    if (!(flags & 8)) throw refused('luz');
    const out = lightOut;
    light.position.set(out[0], out[1], out[2]);
    light.color.r = out[3]; light.color.g = out[4]; light.color.b = out[5];
    light.intensity = out[6]; light.distance = out[7]; light.decay = out[8];
    if (spotlight) {
      // A ceiling cone points down its local Y axis. World-up would be
      // parallel to it, forcing lookAt's arbitrary fallback, and would
      // also roll the cached texture during a cabinet turn. An orthogonal
      // model-space up follows the complete room consistently instead.
      light.shadow.camera.up.set(out[9], out[10], out[11]);
      light.target.position.set(out[12], out[13], out[14]);
      light.target.updateMatrixWorld(true);
      light.angle = out[15]; light.penumbra = out[16];
      light.shadow.camera.near = out[17]; light.shadow.camera.far = out[18];
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.normalBias = out[19];
    }
    light.updateMatrixWorld(true);
    if (flags & 2) light.shadow.updateMatrices(light);
    if (flags & 4) { light.shadow.needsUpdate = true; shadowRefresh = true; }
    return (flags & 1) !== 0;
  }
  return {
    /** Build the pool from the library's lamps alone, before their models
     * exist, so programs linked ahead of the first frame see its final lights. */
    prepare(entries) {
      if (!disposed && reconcile(entries)) prepared = true;
    },
    update(entries, { scroll = 0, viewportHeight = Infinity, shadowDirty = false, transform = null } = {}) {
      if (disposed) return false;
      const shelf = needRustShelf();
      let rootMatrix = null;
      if (transform) {
        if (!shelf.lamp_root(transform.elements, rootOut)) throw refused('sala');
        if (rootOut[0] !== 0) rootMatrix = transform;
      }
      const middle = Number.isFinite(viewportHeight) ? scroll + viewportHeight / 2 : 0;
      shadowRefresh = false;
      let changed = reconcile(entries) || prepared;
      prepared = false;
      candidates.length = 0;
      for (const entry of entries) if (isCandidate(entry)) candidates.push(entry);
      // The lit lamps are the powered ones nearest the view (or picked up),
      // as many of each kind as it has slots. An unpowered lamp never takes
      // a slot, but keeps the one it already holds until another needs it.
      const count = candidates.length, total = slots.length;
      if (keyIds.size > Math.max(32, 2 * (count + total))) {
        const liveKeys = new Set(candidates.map(entry => entry.key));
        for (const slot of slots) liveKeys.add(slot.key);
        for (const key of keyIds.keys()) if (!liveKeys.has(key)) keyIds.delete(key);
      }
      if (candidateIn.length !== 7 * count) candidateIn = new Float64Array(7 * count);
      if (slotIn.length !== 3 * total) slotIn = new Float64Array(3 * total);
      if (planOut.length < 2 + 2 * count + 3 * total) planOut = new Float64Array(2 + 2 * count + 3 * total);
      identities.clear();
      for (let index = 0; index < total; index++) {
        const slot = slots[index];
        slotIn[3 * index] = kindCode(slot.kind); slotIn[3 * index + 1] = idOf(slot.key); slotIn[3 * index + 2] = slot.lit ? 1 : 0;
      }
      for (let index = 0; index < count; index++) {
        const entry = candidates[index], at = 7 * index;
        candidateIn[at] = kindOf(entry) ? kindCode(kindOf(entry)) : -1;
        candidateIn[at + 1] = idOf(entry.key);
        candidateIn[at + 2] = entry.node?.classList.contains('is-dragging') ? 1 : 0;
        candidateIn[at + 3] = Number(entry.model.userData.lightEmitter.power ?? 1);
        candidateIn[at + 4] = (entry.rect?.top + entry.rect?.bottom) / 2;
        let first = identities.get(entry);
        if (first === undefined) identities.set(entry, first = index);
        candidateIn[at + 5] = first;
      }
      if (!poolState().plan(candidateIn, slotIn, middle, planOut, rankKeys)) throw refused('plan');
      const events = planOut[1];
      for (let event = 0; event < events; event++) {
        const entry = candidates[planOut[3 + 2 * event]];
        assign(slots[planOut[2 + 2 * event]], entry.key);
      }
      // A lamp that is to be lit but finds no light of its kind (its fixture's tables are still loading) is an error.
      if (planOut[0] >= 0) assign(null, candidates[planOut[0]].key);
      const base = 2 + 2 * count;
      for (let index = 0; index < total; index++) {
        const slot = slots[index], at = base + 3 * index, found = planOut[at];
        if (found < 0) { if (slot.key !== null) { release(slot); changed = true; } continue; }
        const entry = candidates[found], wasLit = slot.lit, lit = planOut[at + 1] !== 0;
        slot.lit = lit; slot.power = planOut[at + 2];
        if (lit !== wasLit) changed = true;
        if (slot.filaments ? updateFilaments(slot, entry, wasLit) : updateLight(slot, entry, wasLit, shadowDirty, rootMatrix)) changed = true;
      }
      candidates.length = 0; identities.clear();
      return changed;
    },
    get activeCount() {
      let count = 0;
      for (const slot of slots) if (slot.lit) count++;
      return count;
    },
    get activePower() {
      let power = 0;
      for (const slot of slots) power = Math.max(power, slot.power);
      return power;
    },
    get shadowCount() {
      let count = 0;
      for (const slot of slots) if (slot.lit && slot.shadow) count++;
      return count;
    },
    /** The last update invalidated a lamp's cone shadow map. */
    get shadowRefresh() { return shadowRefresh; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const slot of slots) removeLights(slot);
      slots.length = 0; keyIds.clear(); pool?.free(); pool = null;
    }
  };
}
