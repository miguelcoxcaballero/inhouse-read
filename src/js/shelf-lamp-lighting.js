import * as THREE from 'three';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { needRustShelf } from './rust-shelf.js';

// Every lamp a library holds gets its own light up to this many: a lamp
// that glows lights the room, whatever the camera or the other lamps do.
export const MAX_SHELF_LAMP_LIGHTS = 8;
const MAX_LAMP_SHADOWS = 2;
// Rust owns fixture quotas, assignment/rank caches, light math, colour caches and shadow
// invalidation/transport state (lamp_light.rs, lamp_room.rs). The host owns Three lights/scene graph,
// marshals emitter/model data and applies the returned light values and shadow commands.
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
export function createShelfLampLighting(scene, { maxLights = MAX_SHELF_LAMP_LIGHTS, onAreaLightsReady, filamentAreas = false, preparedEntries = false } = {}) {
  const kindOf = entry => lampKind(entry, filamentAreas);
  const slots = [];
  // One Rust room for this manager and one arena in its memory for a frame's numbers (the layout is in lamp_room.rs):
  // a frame is two calls, the plan and every point and cone light, whatever the number of lamps.
  let room = null, memory = null, heap = null, lampRoom = 0, lightRoom = 0;
  let roomAt = 0, slotAt = 0, inAt = 0, outAt = 0, lampAt = 0, planAt = 0;
  function roomOf() {
    if (!room) { room = new (needRustShelf().LampRoomFrame)(); memory = room.memory(); }
    return room;
  }
  const fresh = () => { if (heap.buffer !== memory.buffer) heap = new Float64Array(memory.buffer); };
  function arena(count, total) {
    if (count > lampRoom || total > lightRoom || !heap) {
      if (count > lampRoom) lampRoom = count + 8;
      if (total > lightRoom) lightRoom = Math.max(total, MAX_SHELF_LAMP_LIGHTS);
      roomAt = room.reserve(lampRoom, lightRoom) / 8;
      slotAt = roomAt + 16; inAt = slotAt + 3 * lightRoom; outAt = inAt + 37 * lightRoom;
      lampAt = outAt + 21 * lightRoom; planAt = lampAt + 7 * lampRoom;
      heap = new Float64Array(memory.buffer);
    } else fresh();
  }
  const kindCode = kind => kind === 'cone' ? 0 : kind === 'point' ? 1 : Number(kind.slice(10)) + 1;
  const kindName = code => code === 0 ? 'cone' : code === 1 ? 'point' : filamentKind(code - 1);
  // Per-instance protocol state: the kinds of the library's lamps, and what makes the ids of the keys.
  let kindsIn = new Float64Array(0);
  const keyIds = new Map(), identities = new Map();
  let nextKeyId = 0;
  // The set and fixture kinds change only when the shelf layout changes.
  // Keep that structural scan out of the render loop; only the much smaller
  // lamp list needs dynamic visibility/drag checks per frame.
  let lampEntries = [];
  // Rust invalidates ranks; locale-specific String collation is a browser primitive.
  let disposed = false, shadowRefresh = false, prepared = false;
  function removeLights(slot) {
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
    const slot = { kind, code:kindCode(kind), filaments, spotlight, shadow:spotlight && index < MAX_LAMP_SHADOWS, key:null,
      power:0, lit:false };
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
    room.slot_added(slot.code, slot.shadow); slots.push(slot);
  }
  // Giving a slot to another lamp invalidates everything it remembers (the room does that part while it plans).
  function assign(slot, key) {
    slot.key = key;
    for (const light of slot.lights) { light.userData.entryKey = key; light.name = `Shelf lamp light: ${key}`; }
  }
  function release(slot) {
    slot.key = null; slot.power = 0; slot.lit = false;
    for (const light of slot.lights) { light.intensity = 0; light.userData.entryKey = null; light.name = 'Shelf lamp light: idle'; }
  }
  // Every kind of lamp the library owns gets one slot before any gets a
  // second, in a fixed order: the pool never depends on the entries' order.
  function reconcile(entries) {
    lampEntries = entries.filter(entry => entry.kind === 'lamp');
    if (kindsIn.length !== lampEntries.length) kindsIn = new Float64Array(lampEntries.length);
    for (let index = 0; index < lampEntries.length; index++) {
      const entry = lampEntries[index], kind = kindOf(entry);
      kindsIn[index] = kind ? kindCode(kind) : -1;
    }
    const poolOut = roomOf().reconcile(kindsIn, Number(maxLights));
    let changed = false;
    for (let at = 0; at < poolOut.length; at += 3) {
      const kind = kindName(poolOut[at]), want = poolOut[at + 1];
      let have = poolOut[at + 2];
      for (; have < want; have++) { if (createSlot(kind, have) === false) break; changed = true; }
      for (; have > want; have--) {
        const at = slots.findLastIndex(slot => slot.kind === kind);
        room.slot_removed(at); removeLights(slots[at]); slots.splice(at, 1); changed = true;
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
  function updateFilaments(slot, slotIndex, entry, wasLit) {
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
    const flags = room.filaments(slotIndex, slot.lit, wasLit, filamentIn, filamentOut);
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
  // A point or cone light's inputs, into the arena: the model's world matrix, then the emitter.
  function packLight(slot, index, entry) {
    const model = entry.model, emitter = model.userData.lightEmitter, spotlight = slot.spotlight;
    model.updateWorldMatrix(true, false);
    const lightIn = heap, at = inAt + 37 * index, world = model.matrixWorld.elements;
    for (let index = 0; index < 16; index++) lightIn[at + index] = world[index];
    lightIn[at + 16] = emitter.position[0]; lightIn[at + 17] = emitter.position[1]; lightIn[at + 18] = emitter.position[2];
    if (spotlight) { lightIn[at + 19] = emitter.direction[0]; lightIn[at + 20] = emitter.direction[1]; lightIn[at + 21] = emitter.direction[2]; }
    lightIn[at + 22] = Math.floor(emitter.color ?? 0xffd19a) | 0;
    const tint = emitter.tint;
    lightIn[at + 23] = tint ? 1 : 0;
    if (tint) { lightIn[at + 24] = tint[0]; lightIn[at + 25] = tint[1]; lightIn[at + 26] = tint[2]; }
    lightIn[at + 27] = Number(emitter.intensity); lightIn[at + 28] = slot.power; lightIn[at + 29] = Number(emitter.distance);
    lightIn[at + 30] = Number(entry.width); lightIn[at + 31] = Number(emitter.decay);
    lightIn[at + 32] = emitter.angle == null ? 0 : 1; lightIn[at + 33] = emitter.angle;
    lightIn[at + 34] = emitter.penumbra == null ? 0 : 1; lightIn[at + 35] = emitter.penumbra;
    // Raw non-number emitter values compared unequal to Float64 stamps even
    // when their numeric conversion was unchanged (including undefined).
    lightIn[at + 36] = typeof emitter.distance !== 'number' ||
      typeof emitter.position[0] !== 'number' || typeof emitter.position[1] !== 'number' || typeof emitter.position[2] !== 'number' ||
      (spotlight && (typeof emitter.direction[0] !== 'number' || typeof emitter.direction[1] !== 'number' || typeof emitter.direction[2] !== 'number')) ? 1 : 0;
  }
  function applyLight(slot, index) {
    const light = slot.lights[0], out = heap, at = outAt + 21 * index + 1, flags = out[at - 1];
    if (!(flags & 8)) throw refused('luz');
    light.position.set(out[at], out[at + 1], out[at + 2]);
    light.color.r = out[at + 3]; light.color.g = out[at + 4]; light.color.b = out[at + 5];
    light.intensity = out[at + 6]; light.distance = out[at + 7]; light.decay = out[at + 8];
    if (slot.spotlight) {
      // A ceiling cone points down its local Y axis. World-up would be
      // parallel to it, forcing lookAt's arbitrary fallback, and would
      // also roll the cached texture during a cabinet turn. An orthogonal
      // model-space up follows the complete room consistently instead.
      light.shadow.camera.up.set(out[at + 9], out[at + 10], out[at + 11]);
      light.target.position.set(out[at + 12], out[at + 13], out[at + 14]);
      light.target.updateMatrixWorld(true);
      light.angle = out[at + 15]; light.penumbra = out[at + 16];
      light.shadow.camera.near = out[at + 17]; light.shadow.camera.far = out[at + 18];
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.normalBias = out[at + 19];
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
      // Every prepare announces a change, whether or not the pool changed: a committed layout repaints the room once.
      if (!disposed) { reconcile(entries); prepared = true; }
    },
    update(entries, { scroll = 0, viewportHeight = Infinity, shadowDirty = false, transform = null } = {}) {
      if (disposed) return false;
      needRustShelf();
      // The room's transform: the lights follow it when it is a uniform similarity (the room decides while it plans).
      const follow = transform ? transform.elements : null;
      if (follow && !(follow.length >= 16)) throw refused('sala');
      const middle = Number.isFinite(viewportHeight) ? scroll + viewportHeight / 2 : 0;
      shadowRefresh = false;
      // Standalone callers may provide a fresh entry set on each update.
      let changed = (!preparedEntries && reconcile(entries)) || prepared;
      prepared = false;
      candidates.length = 0;
      for (const entry of lampEntries) if (isCandidate(entry)) candidates.push(entry);
      // The lit lamps are the powered ones nearest the view (or picked up),
      // as many of each kind as it has slots. An unpowered lamp never takes
      // a slot, but keeps the one it already holds until another needs it.
      const count = candidates.length, total = slots.length;
      if (keyIds.size > Math.max(32, 2 * (count + total))) {
        const liveKeys = new Set(candidates.map(entry => entry.key));
        for (const slot of slots) liveKeys.add(slot.key);
        for (const key of keyIds.keys()) if (!liveKeys.has(key)) keyIds.delete(key);
      }
      // Neither a lamp that may be lit nor a light: nothing to plan, nothing to aim.
      if (!count && !total) return changed;
      const frame = roomOf();
      arena(count, total);
      const packed = heap;
      if (follow) for (let index = 0; index < 16; index++) packed[roomAt + index] = follow[index];
      identities.clear();
      for (let index = 0; index < total; index++) {
        const slot = slots[index], at = slotAt + 3 * index;
        packed[at] = slot.code; packed[at + 1] = idOf(slot.key); packed[at + 2] = slot.lit ? 1 : 0;
      }
      for (let index = 0; index < count; index++) {
        const entry = candidates[index], at = lampAt + 7 * index;
        packed[at] = kindOf(entry) ? kindCode(kindOf(entry)) : -1;
        packed[at + 1] = idOf(entry.key);
        packed[at + 2] = entry.node?.classList.contains('is-dragging') ? 1 : 0;
        packed[at + 3] = Number(entry.model.userData.lightEmitter.power ?? 1);
        packed[at + 4] = (entry.rect?.top + entry.rect?.bottom) / 2;
        let first = identities.get(entry);
        if (first === undefined) identities.set(entry, first = index);
        packed[at + 5] = first;
      }
      if (!frame.plan(count, total, follow !== null, middle, rankKeys)) throw refused('plan');
      fresh();
      const events = heap[planAt + 1];
      for (let event = 0; event < events; event++) {
        const entry = candidates[heap[planAt + 3 + 2 * event]];
        assign(slots[heap[planAt + 2 + 2 * event]], entry.key);
      }
      // A lamp that is to be lit but finds no light of its kind (its fixture's tables are still loading) is an error.
      if (heap[planAt] >= 0) assign(null, candidates[heap[planAt]].key);
      const base = planAt + 2 + 2 * count;
      let lights = 0;
      for (let index = 0; index < total; index++) {
        const slot = slots[index], at = base + 3 * index, found = heap[at];
        if (found < 0) { if (slot.key !== null) { release(slot); changed = true; } continue; }
        const entry = candidates[found], wasLit = slot.lit, lit = heap[at + 1] !== 0;
        slot.lit = lit; slot.power = heap[at + 2];
        if (lit !== wasLit) changed = true;
        if (slot.filaments) { if (updateFilaments(slot, index, entry, wasLit)) changed = true; fresh(); }
        else { packLight(slot, index, entry); lights++; }
      }
      if (lights) {
        frame.sample(shadowDirty);
        for (let index = 0; index < total; index++) {
          if (!slots[index].filaments && heap[base + 3 * index] >= 0 && applyLight(slots[index], index)) changed = true;
        }
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
      slots.length = 0; keyIds.clear(); room?.free(); room = memory = heap = null;
    }
  };
}
