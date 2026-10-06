import * as THREE from 'three';
import { tintColor } from './lamp-kelvin.js';
import { getCatalogLamp } from './lamp-catalog-data.js';

export const MAX_SHELF_LAMP_LIGHTS = 4;
const MAX_LAMP_SHADOWS = 2;
const position = new THREE.Vector3(), direction = new THREE.Vector3();
const localMatrix = new THREE.Matrix4(), inverseRoot = new THREE.Matrix4();
const stripStart = new THREE.Vector3(), stripEnd = new THREE.Vector3(), stripNormal = new THREE.Vector3();
const stripX = new THREE.Vector3(), stripY = new THREE.Vector3(), stripZ = new THREE.Vector3();
const stripBasis = new THREE.Matrix4(), modelRotation = new THREE.Quaternion();
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
if (savedLampsNeedAreaLights()) await ensureAreaLights().catch(() => {});

function emitterPower(emitter) {
  const power = Number(emitter.power ?? 1);
  return Number.isFinite(power) ? THREE.MathUtils.clamp(power, 0, 1) : 1;
}

function sameMatrix(a, b) {
  for (let index = 0; index < 16; index++) {
    const value = a.elements[index], other = b.elements[index];
    if (!(Math.abs(value - other) <= 1e-7 * Math.max(1, Math.abs(value), Math.abs(other)))) return false;
  }
  return true;
}

function uniformTransform(matrix) {
  const e = matrix.elements, size = e[0] ** 2 + e[1] ** 2 + e[2] ** 2,
    tolerance = Math.max(1, size) * 1e-7;
  return size > 0 && Number.isFinite(size) && matrix.determinant() > 0 &&
    Math.abs(e[4] ** 2 + e[5] ** 2 + e[6] ** 2 - size) <= tolerance &&
    Math.abs(e[8] ** 2 + e[9] ** 2 + e[10] ** 2 - size) <= tolerance &&
    Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) <= tolerance &&
    Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) <= tolerance &&
    Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) <= tolerance;
}

/** Change detection without garbage: values are compared exactly (NaN equals
 * itself) against the previous frame's and stored in place, instead of being
 * joined into a fresh string every frame. */
class Stamp {
  constructor(size) { this.values = new Float64Array(size); this.index = 0; this.changed = false; }
  begin() { this.index = 0; this.changed = false; }
  /** Forget everything: the next frame compares unequal to every value. */
  reset() { this.values.fill(NaN); }
  add(value) {
    const last = this.values[this.index];
    if (last !== value && (last === last || value === value)) { this.values[this.index] = value; this.changed = true; }
    this.index++;
  }
}

// Reused every frame; emptied before returning so no entry is retained.
const candidates = [], wanted = [];
const POSE_VALUES = 11;
let middle = 0;
const FILAMENT_KINDS = [];
const filamentKind = count => FILAMENT_KINDS[count] ||= `filaments:${count}`;
// Which lights a lamp needs. A culled model is known from the catalogue, so
// scrolling a lamp out of the pool's reach never changes the set of lights.
function kindOf(entry) {
  const emitter = entry.model?.userData.lightEmitter;
  if (emitter) return emitter.filaments?.length ? filamentKind(emitter.filaments.length) :
    Array.isArray(emitter.direction) ? 'cone' : 'point';
  return getCatalogLamp(entry.lampId)?.light ?? null;
}
const isCandidate = entry => entry.kind === 'lamp' && entry.model?.visible &&
  entry.model.userData.lightEmitter && !entry.node?.classList.contains('is-away') && !entry.trashDrop;
// The picked lamp keeps its pool while moving. Others nearest the
// camera centre have priority, with a stable key resolving equal scores.
const priority = entry => entry.node?.classList.contains('is-dragging') ? -Infinity :
  Math.abs((entry.rect?.top + entry.rect?.bottom) / 2 - middle) || 0;
const byPriority = (a, b) => priority(a) - priority(b) || String(a.key).localeCompare(String(b.key));

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
 */
export function createShelfLampLighting(scene, { maxLights = MAX_SHELF_LAMP_LIGHTS, onAreaLightsReady } = {}) {
  const slots = [], kinds = [], counts = new Map(), quota = new Map(), ranks = new Map();
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
    const slot = { kind, filaments, spotlight, shadow:spotlight && index < MAX_LAMP_SHADOWS, key:null, entry:null,
      power:0, lit:false, stale:false, hasTransform:false, localMatrix:new THREE.Matrix4(), rootMatrix:new THREE.Matrix4(),
      shadowStamp:new Stamp(12), lightStamp:new Stamp(5), emitterStamp:new Stamp(9), poseStamp:new Stamp(filaments * POSE_VALUES) };
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
    slot.key = key; slot.stale = true; slot.hasTransform = false;
    slot.shadowStamp.reset(); slot.lightStamp.reset(); slot.emitterStamp.reset(); slot.poseStamp.reset();
    for (const light of slot.lights) { light.userData.entryKey = key; light.name = `Shelf lamp light: ${key}`; }
  }
  function release(slot) {
    slot.key = null; slot.power = 0; slot.lit = false;
    for (const light of slot.lights) { light.intensity = 0; light.userData.entryKey = null; light.name = 'Shelf lamp light: idle'; }
  }
  // Every kind of lamp the library owns gets one slot before any gets a
  // second, in a fixed order: the pool never depends on the entries' order.
  function reconcile(entries) {
    for (const kind of kinds) counts.set(kind, 0);
    for (const entry of entries) {
      if (entry.kind !== 'lamp') continue;
      const kind = kindOf(entry);
      if (!kind) continue;
      if (!counts.has(kind)) { kinds.push(kind); kinds.sort(); counts.set(kind, 0); }
      counts.set(kind, counts.get(kind) + 1);
    }
    let left = Math.max(0, Math.min(MAX_SHELF_LAMP_LIGHTS, maxLights));
    for (const kind of kinds) quota.set(kind, 0);
    for (const kind of kinds) if (left > 0 && counts.get(kind) > 0) { quota.set(kind, 1); left--; }
    for (let grew = true; grew && left > 0;) {
      grew = false;
      for (const kind of kinds) if (left > 0 && quota.get(kind) < counts.get(kind)) { quota.set(kind, quota.get(kind) + 1); left--; grew = true; }
    }
    let changed = false;
    for (const kind of kinds) {
      let have = 0;
      for (const slot of slots) if (slot.kind === kind) have++;
      for (; have < quota.get(kind); have++) { if (createSlot(kind, have) === false) break; changed = true; }
      for (; have > quota.get(kind); have--) {
        const index = slots.findLastIndex(slot => slot.kind === kind);
        removeLights(slots[index]); slots.splice(index, 1); changed = true;
      }
    }
    return changed;
  }
  const holds = entry => { for (const slot of slots) if (slot.entry === entry) return true; return false; };
  function updateFilaments(slot, entry, wasLit) {
    const model = entry.model, emitter = model.userData.lightEmitter;
    model.updateWorldMatrix(true, false); model.getWorldQuaternion(modelRotation);
    const scale = model.matrixWorld.getMaxScaleOnAxis();
    const pose = slot.poseStamp; pose.begin();
    for (let index = 0; index < slot.lights.length; index++) {
      const strip = emitter.filaments[index], light = slot.lights[index];
      stripStart.fromArray(strip.start); stripEnd.fromArray(strip.end);
      stripY.subVectors(stripEnd, stripStart);
      const length = stripY.length(); stripY.normalize();
      stripNormal.fromArray(strip.normal).normalize();
      stripNormal.addScaledVector(stripY, -stripNormal.dot(stripY)).normalize();
      // RectAreaLight emits towards local -Z. Orient each strip along
      // its actual LED fibre and out through the surrounding glass.
      stripZ.copy(stripNormal).negate(); stripX.crossVectors(stripY, stripZ).normalize();
      stripBasis.makeBasis(stripX, stripY, stripZ);
      light.quaternion.setFromRotationMatrix(stripBasis).premultiply(modelRotation);
      light.position.copy(stripStart).add(stripEnd).multiplyScalar(.5).applyMatrix4(model.matrixWorld);
      light.width = strip.width * scale; light.height = length * scale;
      tintColor(light.color.set(emitter.color ?? 0xffd19a), emitter.tint);
      // Four outward Lambertian strips retain the old bulb's total
      // luminous flux. Radiance stays constant under uniform room zoom;
      // their physical emitting area supplies the squared scale factor.
      light.intensity = Math.max(0, Number(emitter.intensity) || 0) * slot.power *
        4 / (slot.lights.length * strip.width * length);
      light.updateMatrixWorld(true);
      pose.add(light.position.x); pose.add(light.position.y); pose.add(light.position.z);
      pose.add(light.quaternion.x); pose.add(light.quaternion.y); pose.add(light.quaternion.z); pose.add(light.quaternion.w);
      pose.add(light.width); pose.add(light.height); pose.add(light.intensity); pose.add(light.color.getHex());
    }
    return pose.changed && (slot.lit || wasLit);
  }
  // rootMatrix: the room's transform when the lights can follow it, else null.
  function updateLight(slot, entry, wasLit, shadowDirty, rootMatrix) {
    const model = entry.model, emitter = model.userData.lightEmitter, light = slot.lights[0];
    const { spotlight, shadow:shadowed } = slot;
    model.updateWorldMatrix(true, false);
    if (rootMatrix) localMatrix.multiplyMatrices(inverseRoot, model.matrixWorld);
    const scale = model.matrixWorld.getMaxScaleOnAxis();
    position.fromArray(emitter.position).applyMatrix4(model.matrixWorld); light.position.copy(position);
    tintColor(light.color.set(emitter.color ?? 0xffd19a), emitter.tint);
    light.intensity = Math.max(0, Number(emitter.intensity) || 0) * slot.power * scale * scale;
    light.distance = Math.max(.01, Number(emitter.distance) || entry.width * 6) * scale;
    light.decay = Number(emitter.decay) || 2;
    if (spotlight) {
      direction.fromArray(emitter.direction).normalize();
      // A ceiling cone points down its local Y axis. World-up would be
      // parallel to it, forcing lookAt's arbitrary fallback, and would
      // also roll the cached texture during a cabinet turn. An orthogonal
      // model-space up follows the complete room consistently instead.
      const zUp = Math.abs(direction.z) < .9;
      light.shadow.camera.up.set(zUp ? 0 : 1, 0, zUp ? 1 : 0).transformDirection(model.matrixWorld);
      direction.transformDirection(model.matrixWorld);
      light.target.position.copy(position).addScaledVector(direction, light.distance);
      light.target.updateMatrixWorld(true);
      light.angle = Math.min(Math.PI / 2, Math.max(.01, emitter.angle ?? Math.PI * .38));
      light.penumbra = emitter.penumbra ?? .65;
      light.shadow.camera.near = Math.max(.01, .5 * scale);
      light.shadow.camera.far = light.distance;
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.normalBias = .15 * scale;
    }
    light.updateMatrixWorld(true);
    // Switching or fading a lamp changes its radiance, not the stored
    // caster depths. Keep these signatures separate so filament animation
    // does not schedule a depth and blur pass on every frame.
    const { shadowStamp, lightStamp, emitterStamp } = slot;
    shadowStamp.begin(); lightStamp.begin(); emitterStamp.begin();
    shadowStamp.add(light.position.x); shadowStamp.add(light.position.y); shadowStamp.add(light.position.z);
    shadowStamp.add(light.distance);
    if (spotlight) {
      const { target, shadow } = light;
      shadowStamp.add(target.position.x); shadowStamp.add(target.position.y); shadowStamp.add(target.position.z);
      shadowStamp.add(shadow.camera.up.x); shadowStamp.add(shadow.camera.up.y); shadowStamp.add(shadow.camera.up.z);
      shadowStamp.add(light.angle);
    } else for (let index = 0; index < 7; index++) shadowStamp.add(0);
    shadowStamp.add(shadowed ? 1 : 0);
    lightStamp.add(light.intensity); lightStamp.add(light.color.getHex()); lightStamp.add(light.decay);
    lightStamp.add(spotlight ? light.angle : 0); lightStamp.add(spotlight ? light.penumbra : 0);
    for (let axis = 0; axis < 3; axis++) emitterStamp.add(emitter.position[axis]);
    for (let axis = 0; axis < 3; axis++) emitterStamp.add(spotlight ? emitter.direction[axis] : 0);
    emitterStamp.add(emitter.distance); emitterStamp.add(spotlight ? light.angle : 0); emitterStamp.add(shadowed ? 1 : 0);
    const emitterChanged = emitterStamp.changed;
    const rootMoved = Boolean(rootMatrix) && slot.hasTransform && !sameMatrix(rootMatrix, slot.rootMatrix);
    if (shadowed && (shadowStamp.changed || emitterChanged || shadowDirty || rootMoved)) {
      const unchangedRoom = Boolean(rootMatrix) && slot.hasTransform && !shadowDirty &&
        !emitterChanged && sameMatrix(localMatrix, slot.localMatrix);
      // The cone and the entire furnished room moved together. Its
      // projection (including near/far under a uniform zoom) preserves
      // the cached depth values, even during the isometric turn.
      if (unchangedRoom) light.shadow.updateMatrices(light);
      else slot.stale = true;
    }
    // An unlit cone only remembers that its map is out of date: the depth
    // pass is paid once the lamp is lit, never while it stays off.
    if (shadowed && slot.lit && slot.stale) { light.shadow.needsUpdate = true; slot.stale = false; shadowRefresh = true; }
    slot.hasTransform = Boolean(rootMatrix);
    if (rootMatrix) { slot.localMatrix.copy(localMatrix); slot.rootMatrix.copy(rootMatrix); }
    return (slot.lit || wasLit) && (shadowStamp.changed || lightStamp.changed || emitterChanged || shadowDirty || rootMoved);
  }
  return {
    /** Build the pool from the library's lamps alone, before their models
     * exist, so programs linked ahead of the first frame see its final lights. */
    prepare(entries) {
      if (!disposed && reconcile(entries)) prepared = true;
    },
    update(entries, { scroll = 0, viewportHeight = Infinity, shadowDirty = false, transform = null } = {}) {
      if (disposed) return false;
      const rootMatrix = transform && uniformTransform(transform) ? transform : null;
      if (rootMatrix) inverseRoot.copy(rootMatrix).invert();
      middle = Number.isFinite(viewportHeight) ? scroll + viewportHeight / 2 : 0;
      shadowRefresh = false;
      let changed = reconcile(entries) || prepared;
      prepared = false;
      candidates.length = 0;
      for (const entry of entries) if (isCandidate(entry)) candidates.push(entry);
      if (candidates.length > 1) candidates.sort(byPriority);
      // The lit lamps are the powered ones nearest the view (or picked up),
      // as many of each kind as it has slots. An unpowered lamp never takes
      // a slot, but keeps the one it already holds until another needs it.
      wanted.length = 0;
      for (const kind of kinds) ranks.set(kind, 0);
      for (const entry of candidates) {
        if (emitterPower(entry.model.userData.lightEmitter) <= 0) continue;
        const kind = kindOf(entry), rank = ranks.get(kind);
        ranks.set(kind, rank + 1);
        if (rank < quota.get(kind)) wanted.push(entry.key);
      }
      for (const slot of slots) slot.entry = null;
      for (const entry of candidates) {
        const kind = kindOf(entry);
        for (const slot of slots) if (slot.key === entry.key && slot.kind === kind) slot.entry = entry;
      }
      for (const entry of candidates) {
        if (!wanted.includes(entry.key) || holds(entry)) continue;
        const kind = kindOf(entry);
        let target = null;
        for (const slot of slots) {
          if (slot.kind !== kind) continue;
          if (!slot.entry) { target = slot; break; }
          if (!target && !wanted.includes(slot.entry.key)) target = slot;
        }
        assign(target, entry.key); target.entry = entry;
      }
      for (const slot of slots) {
        const entry = slot.entry; slot.entry = null;
        if (!entry) { if (slot.key !== null) { release(slot); changed = true; } continue; }
        const wasLit = slot.lit, lit = wanted.includes(entry.key);
        slot.lit = lit; slot.power = lit ? emitterPower(entry.model.userData.lightEmitter) : 0;
        if (lit !== wasLit) changed = true;
        if (slot.filaments ? updateFilaments(slot, entry, wasLit) : updateLight(slot, entry, wasLit, shadowDirty, rootMatrix)) changed = true;
      }
      candidates.length = 0; wanted.length = 0;
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
      slots.length = 0;
    }
  };
}
