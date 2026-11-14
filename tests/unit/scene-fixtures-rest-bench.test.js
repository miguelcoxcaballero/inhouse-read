// Not a test of behaviour: the measurement behind "a bin and a lamp at rest cost the frame nothing"
// (bookshelf-scene.js updateTrash and advanceLampPower). `previous` is each stage as it stood (frozen
// here), `current` as it stands; the real bin and lamp models, plain objects for buttons, no DOM in the
// clock. Interleaved rounds, medians. It only runs when asked:
//   SCENE_BENCH=1 npx vitest run tests/unit/scene-fixtures-rest-bench.test.js
import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { rustShelf as rust } from './helpers/rust-shelf-ready.js';
import { createShelfTrash } from '../../src/js/shelf-trash.js';
import { createShelfLamp } from '../../src/js/shelf-lamps.js';
import { createTintTransition } from '../../src/js/lamp-kelvin.js';

const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const clockNs = () => Number(process.hrtime.bigint());
function compare(name, previous, current, loops = 2000) {
  const time = fn => { const start = clockNs(); for (let i = 0; i < loops; i++) fn(i); return (clockNs() - start) / loops / 1000; };
  for (let i = 0; i < 8; i++) { time(previous); time(current); }
  const old = [], now = [];
  for (let round = 0; round < 41; round++) { if (round % 2) { now.push(time(current)); old.push(time(previous)); } else { old.push(time(previous)); now.push(time(current)); } }
  console.log(`${name}: previous ${median(old).toFixed(3)} us, current ${median(now).toFixed(3)} us`);
}

const bench = process.env.SCENE_BENCH ? it : it.skip;
bench('bin at rest, without the DOM', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }), putImageData() {}, drawImage() {}, clearRect() {} }));
  const furniture = new THREE.Group(); furniture.rotation.set(.244, -.524, 0); furniture.scale.setScalar(.8);
  const trash = createShelfTrash(); furniture.add(trash); trash.position.set(420, -700, 60);
  furniture.updateWorldMatrix(true, false);
  const trashBox = new THREE.Box3(), cornerBox = new Float64Array(6), cornerRect = new Float64Array(7), IDENTITY = new THREE.Matrix4(), trashPacked = new Float64Array(6);
  const corners = box => {
    const { min, max } = box;
    cornerBox[0] = min.x; cornerBox[1] = min.y; cornerBox[2] = min.z; cornerBox[3] = max.x; cornerBox[4] = max.y; cornerBox[5] = max.z;
    rust.scene_corners(cornerBox, IDENTITY.elements, cornerRect);
    trashPacked[0] = cornerRect[0]; trashPacked[1] = cornerRect[1]; trashPacked[2] = cornerRect[2]; trashPacked[3] = cornerRect[3]; trashPacked[4] = cornerRect[4]; trashPacked[5] = cornerRect[5];
  };
  const take = openness => { trash.userData.setState({ openness }); trash.updateMatrixWorld(true); corners(trashBox.setFromObject(trash)); };
  const binNow = new Float64Array(27), binHeld = new Float64Array(27);
  const binNowBits = new Uint32Array(binNow.buffer), binHeldBits = new Uint32Array(binHeld.buffer);
  let binStale = true;
  function binStands(openness) {
    const now = binNow, room = furniture.matrixWorld.elements, { position, quaternion, scale } = trash;
    now[0] = openness;
    for (let index = 0; index < 16; index++) now[index + 1] = room[index];
    now[17] = position.x; now[18] = position.y; now[19] = position.z;
    now[20] = quaternion.x; now[21] = quaternion.y; now[22] = quaternion.z; now[23] = quaternion.w;
    now[24] = scale.x; now[25] = scale.y; now[26] = scale.z;
    // Bit for bit (a zero that changed its sign is a change).
    let same = !binStale;
    for (let index = 0; same && index < 54; index++) same = binNowBits[index] === binHeldBits[index];
    if (same) return true;
    binHeld.set(now); binStale = false;
    return false;
  }
  let meshes = 0; trash.traverse(part => { if (part.isMesh) meshes++; });
  console.log(`bin meshes ${meshes}`);
  compare('bin geometry, still frame', () => take(0), () => { if (!binStands(0)) take(0); });
  compare('bin geometry, lid moving (worst case)', i => take((i % 100) / 100), i => { const o = (i % 100) / 100; if (!binStands(o)) take(o); });
  expect(true).toBe(true);
}, 120000);

bench('lamp at rest, without the DOM', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }), putImageData() {}, drawImage() {}, clearRect() {} }));
  const lampIo = new Float64Array(8), reducedMotion = { matches:false };
  const setData = (element, key, value) => { if (element.dataset[key] !== value) element.dataset[key] = value; };
  let shelfSnapshotDirty = false;
  const make = lampId => ({ kind:'lamp', lampId, isOn:true, kelvin:2700, node:{ dataset:{} },
    model:createShelfLamp({ lampId, width:60, height:100, quality:'high', isOn:true, persist:true, kelvin:2700 }) });
  function previous(entry, now) {
    const target = entry.isOn === false ? 0 : 1;
    const power = entry.lampPower ||= { value:target, from:target, target, started:now, duration:0 };
    lampIo.set([target, power.value, power.from, power.target, power.started, power.duration, now, reducedMotion.matches ? 1 : 0]);
    rust.scene_lamp_power(lampIo);
    [power.value, power.from, power.target, power.started, power.duration] = lampIo;
    entry.model?.userData.setPower?.(power.value);
    if (entry.node) setData(entry.node, 'lampPower', power.value.toFixed(4));
    const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
    if (reducedMotion.matches) tint.set(entry.kelvin, now, false);
    const tinting = tint.advance(now);
    if (entry.model && entry.model.userData.shownTint !== tint.state.value.join()) {
      entry.model.userData.shownTint = tint.state.value.join();
      entry.model.userData.setTint?.(tint.state.value);
      shelfSnapshotDirty = true;
    }
    if (lampIo[6]) shelfSnapshotDirty = true;
    return Boolean(lampIo[5]) || tinting;
  }
  function current(entry, now) {
    const target = entry.isOn === false ? 0 : 1, reduced = reducedMotion.matches;
    const power = entry.lampPower ||= { value:target, from:target, target, started:now, duration:0 };
    let fading = false;
    if (!(power.target === target && Object.is(power.value, power.from + (target - power.from)) &&
        (reduced || power.duration === 0 || power.duration !== power.duration || (now - power.started) / power.duration >= 1))) {
      lampIo[0] = target; lampIo[1] = power.value; lampIo[2] = power.from; lampIo[3] = power.target;
      lampIo[4] = power.started; lampIo[5] = power.duration; lampIo[6] = now; lampIo[7] = reduced ? 1 : 0;
      rust.scene_lamp_power(lampIo);
      power.value = lampIo[0]; power.from = lampIo[1]; power.target = lampIo[2]; power.started = lampIo[3]; power.duration = lampIo[4];
      fading = Boolean(lampIo[5]);
      if (lampIo[6]) shelfSnapshotDirty = true;
    }
    const model = entry.model, node = entry.node;
    const shown = entry.lampShown ||= { model:null, power:NaN, node:null, text:NaN, tinted:null, r:NaN, g:NaN, b:NaN };
    if (shown.model !== model || !Object.is(shown.power, power.value)) {
      shown.model = model; shown.power = power.value; model?.userData.setPower?.(power.value);
    }
    if (node && (shown.node !== node || !Object.is(shown.text, power.value))) {
      shown.node = node; shown.text = power.value; setData(node, 'lampPower', power.value.toFixed(4));
    }
    const tint = entry.lampTint ||= createTintTransition(entry.kelvin);
    if (reduced) tint.set(entry.kelvin, now, false);
    const tinting = tint.advance(now), value = tint.state.value;
    if (model && (shown.tinted !== model || shown.r !== value[0] || shown.g !== value[1] || shown.b !== value[2])) {
      shown.tinted = model; shown.r = value[0]; shown.g = value[1]; shown.b = value[2];
      const text = value.join();
      if (model.userData.shownTint !== text) {
        model.userData.shownTint = text;
        model.userData.setTint?.(value);
        shelfSnapshotDirty = true;
      }
    }
    return fading || tinting;
  }
  for (const lampId of ['tarnaby', 'mittled']) {
    const a = make(lampId), b = make(lampId);
    a.model.userData.shownTint = b.model.userData.shownTint = '1,1,1';
    compare(`lamp ${lampId} at rest`, i => previous(a, 1000 + i * 16), i => current(b, 1000 + i * 16));
    // A fade under way: every frame calls and writes on both sides.
    let flip = 0;
    compare(`lamp ${lampId} fading (worst case)`, i => { if (i % 12 === 0) a.isOn = !a.isOn; previous(a, (flip += 16)); }, i => { if (i % 12 === 0) b.isOn = !b.isOn; current(b, (flip += 16)); });
  }
  expect(shelfSnapshotDirty).toBe(true);
}, 120000);
