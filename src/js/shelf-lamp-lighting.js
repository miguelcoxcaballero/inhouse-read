import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export const MAX_SHELF_LAMP_LIGHTS = 4;
const MAX_LAMP_SHADOWS = 2;
const position = new THREE.Vector3(), direction = new THREE.Vector3();
const localMatrix = new THREE.Matrix4(), inverseRoot = new THREE.Matrix4();
const stripStart = new THREE.Vector3(), stripEnd = new THREE.Vector3(), stripNormal = new THREE.Vector3();
const stripX = new THREE.Vector3(), stripY = new THREE.Vector3(), stripZ = new THREE.Vector3();
const stripBasis = new THREE.Matrix4(), modelRotation = new THREE.Quaternion();
let areaUniformsReady = false;

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
  add(value) {
    const last = this.values[this.index];
    if (last !== value && (last === last || value === value)) { this.values[this.index] = value; this.changed = true; }
    this.index++;
  }
}

// Reused every frame; emptied before returning so no entry is retained.
const candidates = [], selectedKeys = new Set();
const POSE_VALUES = 11;
let middle = 0;
const isCandidate = entry => entry.kind === 'lamp' && entry.model?.visible &&
  entry.model.userData.lightEmitter && emitterPower(entry.model.userData.lightEmitter) > 0 &&
  !entry.node?.classList.contains('is-away') && !entry.trashDrop;
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
 */
export function createShelfLampLighting(scene, { maxLights = MAX_SHELF_LAMP_LIGHTS } = {}) {
  const fixtures = new Map();
  let disposed = false;
  function remove(key) {
    const fixture = fixtures.get(key);
    if (!fixture) return;
    for (const light of fixture.lights || [fixture.light]) {
      light.removeFromParent(); light.target?.removeFromParent();
      light.shadow?.map?.dispose(); light.shadow?.mapPass?.dispose();
    }
    fixtures.delete(key);
  }
  function create(key, spotlight) {
    const light = spotlight ? new THREE.SpotLight() : new THREE.PointLight();
    light.name = `Shelf lamp light: ${key}`;
    light.userData.shelfLamp = true; light.userData.entryKey = key;
    if (spotlight) {
      light.shadow.mapSize.set(512, 512); light.shadow.autoUpdate = false;
      light.shadow.radius = 2; light.shadow.blurSamples = 4;
      light.shadow.bias = -.0002; light.shadow.intensity = .8;
      scene.add(light.target);
    }
    scene.add(light);
    // Point lights store no cone: its stamp slots stay zero.
    const fixture = { light, spotlight, power:0, shadowStamp:new Stamp(12), lightStamp:new Stamp(5), emitterStamp:new Stamp(9),
      localMatrix:new THREE.Matrix4(), rootMatrix:new THREE.Matrix4(), hasTransform:false };
    fixtures.set(key, fixture);
    return fixture;
  }
  function createFilaments(key, strips) {
    if (!areaUniformsReady) { RectAreaLightUniformsLib.init(); areaUniformsReady = true; }
    const lights = strips.map((strip, index) => {
      const light = new THREE.RectAreaLight();
      light.name = `Shelf LED filament: ${key}:${index}`;
      light.userData.shelfLamp = true; light.userData.entryKey = key;
      light.userData.filamentIndex = index;
      scene.add(light); return light;
    });
    const fixture = { light:lights[0], lights, filaments:true, power:0, poseStamp:new Stamp(lights.length * POSE_VALUES) };
    fixtures.set(key, fixture); return fixture;
  }
  return {
    update(entries, { scroll = 0, viewportHeight = Infinity, shadowDirty = false, transform = null } = {}) {
      if (disposed) return false;
      const canTransport = transform && uniformTransform(transform);
      if (canTransport) inverseRoot.copy(transform).invert();
      middle = Number.isFinite(viewportHeight) ? scroll + viewportHeight / 2 : 0;
      candidates.length = 0;
      for (const entry of entries) if (isCandidate(entry)) candidates.push(entry);
      if (candidates.length > 1) candidates.sort(byPriority);
      const selected = candidates;
      selected.length = Math.min(selected.length, Math.max(0, Math.min(MAX_SHELF_LAMP_LIGHTS, maxLights)));
      selectedKeys.clear();
      for (const entry of selected) selectedKeys.add(entry.key);
      let changed = false, shadows = 0;
      for (const key of fixtures.keys()) if (!selectedKeys.has(key)) { remove(key); changed = true; }
      for (const entry of selected) {
        const model = entry.model, emitter = model.userData.lightEmitter;
        if (emitter.filaments?.length) {
          let fixture = fixtures.get(entry.key);
          if (fixture && (!fixture.filaments || fixture.lights.length !== emitter.filaments.length)) {
            remove(entry.key); fixture = null; changed = true;
          }
          if (!fixture) { fixture = createFilaments(entry.key, emitter.filaments); changed = true; }
          model.updateWorldMatrix(true, false); model.getWorldQuaternion(modelRotation);
          const scale = model.matrixWorld.getMaxScaleOnAxis();
          fixture.power = emitterPower(emitter);
          const pose = fixture.poseStamp; pose.begin();
          for (let index = 0; index < fixture.lights.length; index++) {
            const strip = emitter.filaments[index], light = fixture.lights[index];
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
            light.color.set(emitter.color ?? 0xffd19a);
            // Four outward Lambertian strips retain the old bulb's total
            // luminous flux. Radiance stays constant under uniform room zoom;
            // their physical emitting area supplies the squared scale factor.
            light.intensity = Math.max(0, Number(emitter.intensity) || 0) * fixture.power *
              4 / (fixture.lights.length * strip.width * length);
            light.updateMatrixWorld(true);
            pose.add(light.position.x); pose.add(light.position.y); pose.add(light.position.z);
            pose.add(light.quaternion.x); pose.add(light.quaternion.y); pose.add(light.quaternion.z); pose.add(light.quaternion.w);
            pose.add(light.width); pose.add(light.height); pose.add(light.intensity); pose.add(light.color.getHex());
          }
          if (pose.changed) changed = true;
          continue;
        }
        const spotlight = Array.isArray(emitter.direction);
        let fixture = fixtures.get(entry.key);
        if (fixture && (fixture.filaments || fixture.spotlight !== spotlight)) { remove(entry.key); fixture = null; changed = true; }
        if (!fixture) { fixture = create(entry.key, spotlight); changed = true; }
        const { light } = fixture;
        model.updateWorldMatrix(true, false);
        if (canTransport) localMatrix.multiplyMatrices(inverseRoot, model.matrixWorld);
        const scale = model.matrixWorld.getMaxScaleOnAxis();
        fixture.power = emitterPower(emitter);
        position.fromArray(emitter.position).applyMatrix4(model.matrixWorld); light.position.copy(position);
        light.color.set(emitter.color ?? 0xffd19a);
        light.intensity = Math.max(0, Number(emitter.intensity) || 0) * fixture.power * scale * scale;
        light.distance = Math.max(.01, Number(emitter.distance) || entry.width * 6) * scale;
        light.decay = Number(emitter.decay) || 2;
        const shadowed = spotlight && shadows++ < MAX_LAMP_SHADOWS;
        light.castShadow = shadowed;
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
        const { shadowStamp, lightStamp, emitterStamp } = fixture;
        shadowStamp.begin(); lightStamp.begin(); emitterStamp.begin();
        shadowStamp.add(light.position.x); shadowStamp.add(light.position.y); shadowStamp.add(light.position.z);
        shadowStamp.add(light.distance);
        if (spotlight) {
          const { target, shadow } = light;
          shadowStamp.add(target.position.x); shadowStamp.add(target.position.y); shadowStamp.add(target.position.z);
          shadowStamp.add(shadow.camera.up.x); shadowStamp.add(shadow.camera.up.y); shadowStamp.add(shadow.camera.up.z);
          shadowStamp.add(light.angle);
        } else for (let slot = 0; slot < 7; slot++) shadowStamp.add(0);
        shadowStamp.add(shadowed ? 1 : 0);
        lightStamp.add(light.intensity); lightStamp.add(light.color.getHex()); lightStamp.add(light.decay);
        lightStamp.add(spotlight ? light.angle : 0); lightStamp.add(spotlight ? light.penumbra : 0);
        for (let axis = 0; axis < 3; axis++) emitterStamp.add(emitter.position[axis]);
        for (let axis = 0; axis < 3; axis++) emitterStamp.add(spotlight ? emitter.direction[axis] : 0);
        emitterStamp.add(emitter.distance); emitterStamp.add(spotlight ? light.angle : 0); emitterStamp.add(shadowed ? 1 : 0);
        const emitterChanged = emitterStamp.changed;
        const rootMoved = canTransport && fixture.hasTransform && !sameMatrix(transform, fixture.rootMatrix);
        if (shadowStamp.changed || lightStamp.changed || emitterChanged || shadowDirty || rootMoved) {
          const projectionChanged = shadowStamp.changed || emitterChanged || shadowDirty || rootMoved;
          if (shadowed && projectionChanged) {
            const unchangedRoom = canTransport && fixture.hasTransform && !shadowDirty &&
              !emitterChanged && sameMatrix(localMatrix, fixture.localMatrix);
            if (unchangedRoom) {
              // The cone and the entire furnished room moved together. Its
              // projection (including near/far under a uniform zoom) preserves
              // the cached depth values, even during the isometric turn.
              light.shadow.updateMatrices(light);
            } else light.shadow.needsUpdate = true;
          }
          changed = true;
        }
        fixture.hasTransform = Boolean(canTransport);
        if (canTransport) { fixture.localMatrix.copy(localMatrix); fixture.rootMatrix.copy(transform); }
      }
      candidates.length = 0; selectedKeys.clear();
      return changed;
    },
    get activeCount() { return fixtures.size; },
    get activePower() {
      let power = 0;
      for (const fixture of fixtures.values()) power = Math.max(power, fixture.power);
      return power;
    },
    get shadowCount() {
      let count = 0;
      for (const fixture of fixtures.values()) if (fixture.light.castShadow) count++;
      return count;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const key of fixtures.keys()) remove(key);
    }
  };
}
