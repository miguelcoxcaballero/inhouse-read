import * as THREE from 'three';

export const MAX_SHELF_LAMP_LIGHTS = 4;
const MAX_LAMP_SHADOWS = 2;
const position = new THREE.Vector3(), direction = new THREE.Vector3();
const localMatrix = new THREE.Matrix4(), inverseRoot = new THREE.Matrix4();

function emitterPower(emitter) {
  const power = Number(emitter.power ?? 1);
  return Number.isFinite(power) ? THREE.MathUtils.clamp(power, 0, 1) : 1;
}

function sameMatrix(a, b) {
  return a.elements.every((value, index) => Math.abs(value - b.elements[index]) <=
    1e-7 * Math.max(1, Math.abs(value), Math.abs(b.elements[index])));
}

function uniformTransform(matrix) {
  const e = matrix.elements, size = e[0] ** 2 + e[1] ** 2 + e[2] ** 2,
    tolerance = Math.max(1, size) * 1e-7;
  return size > 0 && Number.isFinite(size) && matrix.determinant() > 0 &&
    [e[4] ** 2 + e[5] ** 2 + e[6] ** 2 - size, e[8] ** 2 + e[9] ** 2 + e[10] ** 2 - size,
      e[0] * e[4] + e[1] * e[5] + e[2] * e[6], e[0] * e[8] + e[1] * e[9] + e[2] * e[10],
      e[4] * e[8] + e[5] * e[9] + e[6] * e[10]]
      .every(value => Math.abs(value) <= tolerance);
}

/** Warm fixtures light the actual shelf materials. A small shared budget avoids
 * an ever-growing shader when a library has many decorated rows. Circular
 * under-shelf fixtures use downward cones; exposed bulbs radiate all around.
 * Only two cones cast shadows, avoiding six shadow passes per exposed bulb.
 */
export function createShelfLampLighting(scene, { maxLights = MAX_SHELF_LAMP_LIGHTS } = {}) {
  const fixtures = new Map();
  let disposed = false;
  function remove(key) {
    const fixture = fixtures.get(key);
    if (!fixture) return;
    fixture.light.removeFromParent(); fixture.light.target?.removeFromParent();
    fixture.light.shadow?.map?.dispose(); fixture.light.shadow?.mapPass?.dispose();
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
    const fixture = { light, spotlight, power:0, signature:'', shadowSignature:'', emitterSignature:'', localMatrix:new THREE.Matrix4(),
      rootMatrix:new THREE.Matrix4(), hasTransform:false };
    fixtures.set(key, fixture);
    return fixture;
  }
  return {
    update(entries, { scroll = 0, viewportHeight = Infinity, shadowDirty = false, transform = null } = {}) {
      if (disposed) return false;
      const canTransport = transform && uniformTransform(transform);
      if (canTransport) inverseRoot.copy(transform).invert();
      const middle = Number.isFinite(viewportHeight) ? scroll + viewportHeight / 2 : 0;
      const candidates = entries.filter(entry => entry.kind === 'lamp' && entry.model?.visible &&
        entry.model.userData.lightEmitter && emitterPower(entry.model.userData.lightEmitter) > 0 &&
        !entry.node?.classList.contains('is-away') && !entry.trashDrop);
      // The picked lamp keeps its pool while moving. Others nearest the
      // camera centre have priority, with a stable key resolving equal scores.
      const priority = entry => entry.node?.classList.contains('is-dragging') ? -Infinity :
        Math.abs((entry.rect?.top + entry.rect?.bottom) / 2 - middle) || 0;
      candidates.sort((a, b) => priority(a) - priority(b) || String(a.key).localeCompare(String(b.key)));
      const selected = candidates.slice(0, Math.max(0, Math.min(MAX_SHELF_LAMP_LIGHTS, maxLights)));
      const keys = new Set(selected.map(entry => entry.key));
      let changed = false, shadows = 0;
      for (const key of fixtures.keys()) if (!keys.has(key)) { remove(key); changed = true; }
      for (const entry of selected) {
        const model = entry.model, emitter = model.userData.lightEmitter;
        const spotlight = Array.isArray(emitter.direction);
        let fixture = fixtures.get(entry.key);
        if (fixture && fixture.spotlight !== spotlight) { remove(entry.key); fixture = null; changed = true; }
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
        const shadowSignature = [light.position.x, light.position.y, light.position.z, light.distance,
          ...(spotlight ? [...light.target.position.toArray(), ...light.shadow.camera.up.toArray(), light.angle] : []), shadowed].join(':');
        const signature = [shadowSignature, light.intensity, light.color.getHex(), light.decay,
          light.angle, light.penumbra].join(':');
        const emitterSignature = [emitter.position, emitter.direction, emitter.distance,
          light.angle, shadowed].join(':');
        const rootMoved = canTransport && fixture.hasTransform && !sameMatrix(transform, fixture.rootMatrix);
        if (signature !== fixture.signature || emitterSignature !== fixture.emitterSignature || shadowDirty || rootMoved) {
          const projectionChanged = shadowSignature !== fixture.shadowSignature ||
            emitterSignature !== fixture.emitterSignature || shadowDirty || rootMoved;
          if (shadowed && projectionChanged) {
            const unchangedRoom = canTransport && fixture.hasTransform && !shadowDirty &&
              emitterSignature === fixture.emitterSignature && sameMatrix(localMatrix, fixture.localMatrix);
            if (unchangedRoom) {
              // The cone and the entire furnished room moved together. Its
              // projection (including near/far under a uniform zoom) preserves
              // the cached depth values, even during the isometric turn.
              light.shadow.updateMatrices(light);
            } else light.shadow.needsUpdate = true;
          }
          fixture.signature = signature; changed = true;
        }
        fixture.shadowSignature = shadowSignature;
        fixture.emitterSignature = emitterSignature;
        fixture.hasTransform = Boolean(canTransport);
        if (canTransport) { fixture.localMatrix.copy(localMatrix); fixture.rootMatrix.copy(transform); }
      }
      return changed;
    },
    get activeCount() { return fixtures.size; },
    get activePower() {
      let power = 0;
      for (const fixture of fixtures.values()) power = Math.max(power, fixture.power);
      return power;
    },
    get shadowCount() { return [...fixtures.values()].filter(fixture => fixture.light.castShadow).length; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const key of fixtures.keys()) remove(key);
    }
  };
}
