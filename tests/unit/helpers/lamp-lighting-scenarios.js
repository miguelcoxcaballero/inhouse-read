// Scripted rooms for the lamp-lighting differential checks (unit test and real-Chromium spec): the same random lamps,
// models, rooms and frames go through the module under test and through the frozen original, into separate scenes, and
// after every frame every light of both scenes (type, name, transforms, colour, intensity, range, cone, shadow camera
// and matrices, area size) and every answer of the managers are compared bit for bit, signed zeros and NaNs included.
// The module throws an Error naming the first difference; it uses no test framework, so a browser page can run it too.
import * as THREE from 'three';

export function facts(scene) {
  const rows = []; const add = (label, value) => rows.push([label, value]);
  add('children', scene.children.length);
  scene.children.forEach((object, index) => {
    const tag = `#${index} ${object.type}`;
    add(`${tag} type`, object.type); add(`${tag} name`, object.name); add(`${tag} parent`, object.parent === scene);
    add(`${tag} userData`, JSON.stringify(object.userData)); add(`${tag} castShadow`, object.castShadow);
    for (const axis of ['x', 'y', 'z']) add(`${tag} position.${axis}`, object.position[axis]);
    for (const axis of ['x', 'y', 'z', 'w']) add(`${tag} quaternion.${axis}`, object.quaternion[axis]);
    for (const axis of ['x', 'y', 'z']) add(`${tag} rotation.${axis}`, object.rotation[axis]);
    object.matrix.elements.forEach((value, i) => add(`${tag} matrix[${i}]`, value));
    object.matrixWorld.elements.forEach((value, i) => add(`${tag} matrixWorld[${i}]`, value));
    if (!object.isLight) return;
    for (const channel of ['r', 'g', 'b']) add(`${tag} color.${channel}`, object.color[channel]);
    add(`${tag} intensity`, object.intensity);
    if (object.isPointLight || object.isSpotLight) { add(`${tag} distance`, object.distance); add(`${tag} decay`, object.decay); }
    if (object.isRectAreaLight) { add(`${tag} width`, object.width); add(`${tag} height`, object.height); }
    if (object.isSpotLight) {
      add(`${tag} angle`, object.angle); add(`${tag} penumbra`, object.penumbra); add(`${tag} target`, object.target.parent === scene);
      const { shadow } = object;
      for (const field of ['autoUpdate', 'radius', 'blurSamples', 'bias', 'normalBias', 'intensity', 'needsUpdate']) add(`${tag} shadow.${field}`, shadow[field]);
      add(`${tag} shadow.mapSize`, `${shadow.mapSize.x}x${shadow.mapSize.y}`);
      for (const axis of ['x', 'y', 'z']) add(`${tag} shadow.up.${axis}`, shadow.camera.up[axis]);
      add(`${tag} shadow.near`, shadow.camera.near); add(`${tag} shadow.far`, shadow.camera.far);
      shadow.camera.projectionMatrix.elements.forEach((value, i) => add(`${tag} shadow.projection[${i}]`, value));
      shadow.camera.matrixWorldInverse.elements.forEach((value, i) => add(`${tag} shadow.view[${i}]`, value));
      shadow.matrix.elements.forEach((value, i) => add(`${tag} shadow.matrix[${i}]`, value));
    }
  });
  return rows;
}
export function sameFacts(actual, expected, where) {
  if (actual.length !== expected.length) throw Error(`${where}: ${actual.length} facts instead of ${expected.length}`);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i][0] !== expected[i][0]) throw Error(`${where}: ${actual[i][0]} / ${expected[i][0]}`);
    if (!Object.is(actual[i][1], expected[i][1])) throw Error(`${where}: ${expected[i][0]} is ${actual[i][1]} instead of ${expected[i][1]}`);
  }
}

export function generator(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const KEYS = ['lamp:0', 'lamp:1', 'lamp:2', 'lamp:10', 'lamp:11', 'Lamp:3', 'lamp-4', 'lamp:b', 'lamp:B', 'lamp:ñ', 'lamp:é', 'lamp:Z', 'lamp: 5',
  'lamp:é1', 'plant:7', ' lamp', 'lamp:', 'LAMP:9', 'lamp:a_1', 'lamp:a-1', 'lamp:a1', 'lamp:A1'];

function fixture(random) {
  const pick = (...values) => values[Math.floor(random() * values.length)];
  const vector = range => [(random() - .5) * range, (random() - .5) * range, (random() - .5) * range];
  const emitterOf = shape => {
    const emitter = { position: vector(80), color: pick(0xffd19a, 0xffd19a, 0xffffff, 0, 0xff0000, Math.floor(random() * 0x1000000), undefined),
      intensity: pick(10000, 10000, 0, -5, NaN, undefined, '250', random() * 20000, Infinity, 1e-300),
      distance: pick(400, 400, 0, undefined, NaN, random() * 900, -3), decay: pick(2, 2, 0, undefined, 1.5, NaN) };
    if (random() < .4) emitter.tint = [.8 + random() * .4, .8 + random() * .4, .8 + random() * .4];
    const power = pick(undefined, undefined, 1, 0, .3, .7, 1.5, -1, NaN, Infinity, '0.5', null);
    if (power !== undefined) emitter.power = power;
    if (shape === 'cone') {
      emitter.direction = pick([0, -1, 0], [0, 0, 1], [0, -1, 0], vector(2), [0, 0, 0], [1, 0, 0], [.1, -.95, .05], [0, .5, .86], [0, .5, .9], [0, 0, -.9]);
      if (random() < .6) emitter.angle = pick(.3, Math.PI * .38, 0, 5, -1, NaN, random() * 3, null);
      if (random() < .6) emitter.penumbra = pick(.65, 0, 1, random(), null);
    }
    if (shape === 'filaments') {
      emitter.filaments = Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
        const start = vector(12), delta = pick(vector(14), vector(14), [0, 0, 0]);
        return { start, end: [start[0] + delta[0], start[1] + delta[1], start[2] + delta[2]], normal: pick(vector(2), vector(2), delta, [0, 0, 0]), width: pick(random() * 3 + .1, 2, 0) };
      });
    }
    return emitter;
  };
  const matrixOf = () => {
    const position = new THREE.Vector3(...vector(400)), rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - .5) * 6, (random() - .5) * 6, (random() - .5) * 6));
    const scale = pick(() => { const s = .2 + random() * 3; return new THREE.Vector3(s, s, s); }, () => new THREE.Vector3(.2 + random() * 3, .2 + random() * 3, .2 + random() * 3),
      () => new THREE.Vector3(-1 - random(), 1 + random(), 1), () => new THREE.Vector3(1, 1, 1), () => new THREE.Vector3(2, 2 + 1e-9, 2), () => new THREE.Vector3(0, 1, 1))();
    return new THREE.Matrix4().compose(position, rotation, scale);
  };
  return { pick, vector, emitterOf, matrixOf };
}

function scenario(seed, { createMine, createReference }) {
  const random = generator(seed), { pick, vector, emitterOf, matrixOf } = fixture(random);
  const options = { maxLights: pick(8, 8, 1, 2, 3, 5, 0, 12, NaN, '3', undefined, 2.5, -1), filamentAreas: pick(false, true) };
  const sceneA = new THREE.Scene(), sceneB = new THREE.Scene();
  const mine = createMine(sceneA, options), reference = createReference(sceneB, options);
  const room = new THREE.Group(), keys = [...KEYS];
  const classes = new Set();
  // A library has one key per lamp; one scenario in eight repeats keys, which the original answers with an error.
  const duplicates = random() < .125, pool = [...KEYS].sort(() => random() - .5); let extra = 0;
  const takeKey = () => duplicates ? pick(...keys) : pool.pop() ?? `lamp:x${extra++}`;
  const giveKey = (key, entries) => { if (!duplicates && !entries.some(entry => entry.key === key)) pool.push(key); };
  const entryOf = shape => {
    const model = new THREE.Group(); model.userData.lightEmitter = emitterOf(shape);
    model.position.set(...vector(300)); model.rotation.set((random() - .5) * 3, (random() - .5) * 3, (random() - .5) * 3);
    const s = pick(1, 1, .5, 2.5); model.scale.set(s, pick(s, s, s * 1.3), pick(s, s, .7));
    model.visible = random() < .9; room.add(model);
    const node = { classList: { contains: name => classes.has(`${entry.key}|${name}`) } };
    const entry = { kind: 'lamp', key: takeKey(), model, width: pick(40, 75, 0, undefined, '60'), lampId: pick('mittled', 'tarnaby', 'tripod', 'unknown', undefined),
      rect: pick(null, null, { top: random() * 1500, bottom: random() * 1500 }, { top: 100, bottom: 140 }, { top: NaN, bottom: 3 }, undefined), node, trashDrop: random() < .05 };
    return entry;
  };
  const shapes = ['point', 'cone', 'filaments'];
  const entries = Array.from({ length: Math.floor(random() * 14) }, () => entryOf(pick(...shapes)));
  if (random() < .3 && entries.length) entries.push(entries[0]);
  if (random() < .15) entries.splice(Math.floor(random() * (entries.length + 1)), 0, { kind: 'book', key: 'book:1', model: null });
  if (duplicates && random() < .5 && entries.length > 1) entries[1].key = entries[0].key;
  room.updateMatrixWorld(true);
  return { random, pick, vector, options, mine, reference, sceneA, sceneB, room, entries, classes, entryOf, shapes, emitterOf, duplicates, takeKey, giveKey, matrixOf };
}
function frameOptions(state) {
  const { random, pick, room, matrixOf } = state;
  const o = {};
  if (random() < .6) o.scroll = pick(0, random() * 3000 - 500, 300, -400);
  if (random() < .6) o.viewportHeight = pick(600, 0, NaN, 1e6, Infinity, 320);
  if (random() < .15) o.shadowDirty = true;
  const mode = pick('room', 'room', 'room', 'none', 'random', 'identity');
  if (mode === 'room') o.transform = room.matrixWorld;
  else if (mode === 'random') o.transform = matrixOf();
  else if (mode === 'identity') o.transform = new THREE.Matrix4();
  return o;
}
function mutate(state) {
  const { random, pick, vector, room, entries, classes, entryOf, shapes, takeKey, giveKey } = state;
  const some = () => entries.length ? entries[Math.floor(random() * entries.length)] : null;
  const toggle = name => { if (classes.has(name)) classes.delete(name); else classes.add(name); };
  const steps = 1 + Math.floor(random() * 3);
  for (let step = 0; step < steps; step++) {
    const entry = some();
    switch (Math.floor(random() * 16)) {
      case 0: if (entry?.model) entry.model.visible = !entry.model.visible; break;
      case 1: if (entry) toggle(`${entry.key}|is-away`); break;
      case 2: if (entry) toggle(`${entry.key}|is-dragging`); break;
      case 3: if (entry) entry.trashDrop = !entry.trashDrop; break;
      case 4: if (entry) entry.rect = pick(null, { top: random() * 1500, bottom: random() * 1500 }, { top: 100, bottom: 140 }, { top: NaN, bottom: 3 }, undefined); break;
      case 5: if (entry?.model) { const power = pick(1, 0, .3, .7, 1.5, -1, NaN, Infinity, undefined); if (power === undefined) delete entry.model.userData.lightEmitter.power; else entry.model.userData.lightEmitter.power = power; } break;
      case 6: if (entry?.model) entry.model.userData.lightEmitter.tint = pick(undefined, [1, 1, 1], [.9, 1, 1.2], [NaN, 1, 1]); break;
      case 7: if (entry?.model) entry.model.position.set(...vector(300)); break;
      case 8: if (entry?.model) entry.model.userData.lightEmitter.intensity = pick(10000, 0, 2500, -1, NaN); break;
      case 9: if (entries.length < 16) entries.push(entryOf(pick(...shapes))); break;
      case 10: if (entries.length) { const [gone] = entries.splice(Math.floor(random() * entries.length), 1); if (gone.kind === 'lamp') giveKey(gone.key, entries); } break;
      case 11: if (entries.length > 1) { const a = Math.floor(random() * entries.length), b = Math.floor(random() * entries.length); [entries[a], entries[b]] = [entries[b], entries[a]]; } break;
      case 12: if (entry?.kind === 'lamp') { const old = entry.key; entry.key = takeKey(); giveKey(old, entries); } break;
      case 13: if (entry?.model) entry.model.userData.lightEmitter = state.emitterOf(pick(...shapes)); break;
      case 14: room.position.set(...vector(200)); room.rotation.set((random() - .5) * 3, (random() - .5) * 3, (random() - .5) * 3); room.scale.setScalar(pick(1, 1, .5, 2.4, 3)); break;
      case 15: room.scale.set(pick(1, 1.5), pick(1, 1.5), pick(1, .7)); break;
    }
  }
  room.updateMatrixWorld(true);
}

/** Runs `seeds` scripted rooms of `frames` frames through `createMine(scene, options)` and `createReference(scene, options)`
 * (both build a lamp-lighting manager) and throws at the first difference. Returns what was covered. */
export function compareRooms({ createMine, createReference, seeds, frames }) {
  const coverage = { rooms: 0, frames: 0, answeredTrue: 0, lights: 0, lit: 0, shadows: 0, refreshed: 0, facts: 0, errors: 0, unexpected: 0, filamentFrames: 0, duplicated: 0, messages: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const state = scenario(seed, { createMine, createReference }), { mine, reference, sceneA, sceneB } = state;
    coverage.rooms++; if (state.duplicates) coverage.duplicated++;
    const call = (manager, fn) => { try { return { value: fn(manager) }; } catch (error) { return { error: `${error.constructor.name}: ${error.message}` }; } };
    const check = (where, answerA, answerB) => {
      if (answerA.error !== answerB.error) throw Error(`${where}: error ${answerA.error} instead of ${answerB.error}`);
      if (!answerA.error && answerA.value !== answerB.value) throw Error(`${where}: answer ${answerA.value} instead of ${answerB.value}`);
      const rowsA = facts(sceneA);
      sameFacts(rowsA, facts(sceneB), where);
      for (const getter of ['activeCount', 'activePower', 'shadowCount', 'shadowRefresh']) {
        if (!Object.is(mine[getter], reference[getter])) throw Error(`${where}: ${getter} is ${mine[getter]} instead of ${reference[getter]}`);
      }
      coverage.frames++; coverage.facts += rowsA.length; coverage.lights += sceneA.children.filter(o => o.isLight).length;
      coverage.lit += mine.activeCount; coverage.shadows += mine.shadowCount;
      if (mine.shadowRefresh) coverage.refreshed++;
      if (answerA.value === true) coverage.answeredTrue++;
      if (answerA.error) { coverage.errors++; if (!state.duplicates) { coverage.unexpected++; coverage.messages.push(answerA.error); } }
      if (sceneA.children.some(o => o.isRectAreaLight && o.intensity > 0)) coverage.filamentFrames++;
    };
    if (state.random() < .4) check(`room ${seed} prepare`, call(mine, m => m.prepare(state.entries)), call(reference, m => m.prepare(state.entries)));
    for (let frame = 0; frame < frames; frame++) {
      const options = frameOptions(state), where = `room ${seed} frame ${frame}`;
      check(where, call(mine, m => m.update(state.entries, options)), call(reference, m => m.update(state.entries, options)));
      // The same room again: nothing may be reported and nothing may move.
      if (frame % 5 === 4) check(`${where} (again)`, call(mine, m => m.update(state.entries, options)), call(reference, m => m.update(state.entries, options)));
      mutate(state);
    }
    mine.dispose(); reference.dispose();
    if (sceneA.children.length || sceneB.children.length) throw Error(`room ${seed}: lights left in the scene after dispose`);
  }
  return coverage;
}
