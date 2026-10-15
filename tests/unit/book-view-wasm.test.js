// Differential test: the arithmetic and decisions of a book's view in the numeric core
// (rust-core/src/book_view.rs behind book-view-wasm.js and book-model.js) against the code
// frozen in helpers/reference-book-view.js, on large pseudo-random and edge-case corpora.
// Every number must match to the bit (NaN, infinities and signed zeros included).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getRustCore } from '../../src/js/rust-core.js';
import { boxScreenBounds, fitImage, frameAligned, planBookPose, planBookView, planCopyRectangle,
  planPageBounds, planPageZoom, planReadingPose, planReturnFrame } from '../../src/js/book-view-wasm.js';
import { fitCoverImage, planBookPageZoom, planReadingBookPose, projectBookBoardBounds, projectBookPageBounds } from '../../src/js/book-model.js';
import { referenceBookView, referenceFitCoverImage, referencePlanBookPageZoom, referencePlanReadingBookPose,
  referenceProjectBookBoardBounds, referenceProjectBookPageBounds, referenceViewSizes } from './helpers/reference-book-view.js';

const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rng = seeded(20261015);
const pick = list => list[Math.floor(rng() * list.length)];
const integer = (low, high) => low + Math.floor(rng() * (high - low + 1));
const same = (actual, expected, label) => {
  if (Array.isArray(expected)) { expect(actual.length, label).toBe(expected.length); expected.forEach((v, i) => same(actual[i], v, `${label}[${i}]`)); return; }
  if (expected && typeof expected === 'object') {
    for (const key of Object.keys(expected)) same(actual[key], expected[key], `${label}.${key}`);
    return;
  }
  expect(Object.is(actual, expected), `${label}: ${actual} vs ${expected}`).toBe(true);
};
const odd = () => pick([NaN, Infinity, -Infinity, -0, 0, 1e300, -1e-300, undefined, null]);

describe('view sizes', () => {
  it('equal the original for 100000 random views', () => {
    for (let n = 0; n < 100000; n++) {
      const view = { shelf: rng() < .5, devicePixelRatio: rng() < .1 ? pick([undefined, '2', null, NaN]) : pick([1, 1.5, 2, 2.625, 3, 3.5, .75, rng() * 4]),
        innerWidth: pick([320, 599, 599.5, 600, 601, 1280, NaN, undefined]), viewportWidth: rng() < .1 ? odd() : pick([320, 390, 844, 1280, integer(1, 3000), rng() * 900]),
        viewportHeight: rng() < .1 ? odd() : pick([568, 844, 390, 800, integer(1, 3000), rng() * 900]),
        width: rng() < .1 ? odd() : pick([132, 200, 62.125, rng() * 600]), height: rng() < .1 ? odd() : pick([200, 400, 92.375, rng() * 900]),
        thickness: rng() < .1 ? odd() : pick([8.25, 40, 120, rng() * 150]) };
      same(planBookView(view), referenceViewSizes(view), JSON.stringify(view));
    }
  });
  it('tells whole physical pixels apart', () => {
    for (let n = 0; n < 50000; n++) {
      const values = Array.from({ length: 7 }, (_, i) => i === 2 ? pick([1, 1.5, 2, 3, .5, NaN, 2.625]) : rng() < .08 ? odd() : pick([0, 1, 100, 390, 844, integer(0, 2000), rng() * 500]));
      const expected = [values[0] * values[2], values[1] * values[2], values[3] * values[2], values[4] * values[2], values[5] * values[2], values[6] * values[2]].every(Number.isInteger);
      expect(frameAligned(...values), values.join()).toBe(expected);
    }
  });
});

function viewState(extra = {}) {
  const vw = rng() < .85 ? integer(100, 1400) : pick([NaN, 390.5, 0, -5, Infinity]), vh = rng() < .85 ? integer(100, 1400) : pick([NaN, 844.25, 0, Infinity]);
  const width = pick([132, 200, 62.125, 90, 264]), height = pick([200, 400, 92.375, 240]), thickness = pick([8.25, 40, 120, 15]);
  const ratio = rng() < .85 ? pick([1, 2, 3]) : pick([1.5, 2.625, 0.5, NaN, 0, -1]);
  const sizes = referenceViewSizes({ shelf: false, devicePixelRatio: ratio, innerWidth: 1000, viewportWidth: vw, viewportHeight: vh, width, height, thickness });
  const capacity = () => rng() < .5 ? null : { width: pick([0, 64, 128, 320, 384, vw, integer(0, 1500)]), height: pick([0, 64, 192, 448, vh, integer(0, 1500)]) };
  return { compactReturnFrame: rng() < .85, directEnabled: rng() < .7, adaptiveNativeFrame: rng() < .6, pixelRatio: ratio,
    viewportWidth: vw, viewportHeight: vh, compactWidth: sizes.compactWidth, closedCompactWidth: sizes.closedCompactWidth, compactHeight: sizes.compactHeight,
    current: { coverOpen: pick([0, -0, 0, .5, 1, NaN, undefined]) }, motionFrameCapacity: capacity(), nativeMotionCapacity: capacity(),
    canvas: { width: Math.ceil(vw * ratio), height: Math.ceil(vh * ratio) }, centerX: pick([195, 0, 130.5, NaN]), centerY: pick([350, 0, 421.25]), pageTheme: pick([0, 1, .5]), ...extra };
}
const bounds = (state) => {
  const vw = Number.isFinite(state.viewportWidth) ? state.viewportWidth : 400, vh = Number.isFinite(state.viewportHeight) ? state.viewportHeight : 800;
  const left = rng() * vw * 1.2 - vw * .1, top = rng() * vh * 1.2 - vh * .1;
  const out = [left, top, left + rng() * vw, top + rng() * vh];
  if (rng() < .1) out[integer(0, 3)] = pick([NaN, Infinity, -Infinity, undefined]);
  if (rng() < .05) [out[0], out[2]] = [out[2], out[0]];
  if (rng() < .1) out[0] = -50 - rng() * 100;
  if (rng() < .05) { out[2] = vw + 200; out[3] = vh + 300; out[0] = -100; out[1] = -100; }
  return out;
};
const clone = capacity => capacity && { ...capacity };

describe('return frame', () => {
  it('equals the original for 300000 random views, bounds and reservations', () => {
    let windows = 0, whole = 0, measured = 0;
    for (let n = 0; n < 300000; n++) {
      const state = viewState(), measureOnly = rng() < .3, pose = { scale: pick([1, 1, 1.05, 1.0500001, 1.2, .4, NaN, undefined, 3]) };
      const measuredBounds = bounds(state);
      let referenceMeasurements = 0, rustMeasurements = 0;
      const before = { motion: clone(state.motionFrameCapacity), native: clone(state.nativeMotionCapacity) };
      const reference = referenceBookView(state, () => { referenceMeasurements++; return measuredBounds; }).returnFrame(pose, measureOnly);
      const rust = planReturnFrame({ compact: state.compactReturnFrame, direct: state.directEnabled, adaptive: state.adaptiveNativeFrame, measureOnly,
        scale: pose.scale, ratio: state.pixelRatio, viewportWidth: state.viewportWidth, viewportHeight: state.viewportHeight, coverOpen: state.current.coverOpen,
        closedWidth: state.closedCompactWidth, openWidth: state.compactWidth, height: state.compactHeight, motion: before.motion, native: before.native },
      () => { rustMeasurements++; return measuredBounds; });
      expect(rustMeasurements, 'measurements').toBe(referenceMeasurements);
      const full = reference.camera?.isFull === true;
      expect(rust === null, JSON.stringify({ state, pose, measureOnly, measuredBounds })).toBe(full);
      if (!full) same(rust, { x: reference.x, y: reference.y, width: reference.width, height: reference.height }, 'window');
      same(before.motion, state.motionFrameCapacity, 'motion reservation'); same(before.native, state.nativeMotionCapacity, 'native reservation');
      if (full) whole++; else windows++;
      measured += referenceMeasurements;
    }
    // Every branch was reached: windows, whole frames, early exits (no measurement) and measured ones.
    expect(windows).toBeGreaterThan(10000); expect(whole).toBeGreaterThan(10000); expect(measured).toBeGreaterThan(50000); expect(measured).toBeLessThan(300000);
  }, 120000);

  it('keeps a flight reservation growing monotonically, as the original did', () => {
    for (let flight = 0; flight < 300; flight++) {
      const state = viewState({ compactReturnFrame: true, directEnabled: true, adaptiveNativeFrame: true, viewportWidth: 390, viewportHeight: 844, pixelRatio: 2 });
      state.motionFrameCapacity = { width: 0, height: 0 }; state.nativeMotionCapacity = rng() < .5 ? { width: 0, height: 0 } : null;
      const rustMotion = clone(state.motionFrameCapacity), rustNative = clone(state.nativeMotionCapacity);
      for (let frame = 0; frame < 40; frame++) {
        const measuredBounds = [rng() * 120, rng() * 300, 150 + rng() * 240, 300 + rng() * 540], measureOnly = rng() < .25;
        const reference = referenceBookView(state, () => measuredBounds).returnFrame({ scale: 1 }, measureOnly);
        const rust = planReturnFrame({ compact: true, direct: true, adaptive: true, measureOnly, scale: 1, ratio: 2, viewportWidth: 390, viewportHeight: 844,
          coverOpen: state.current.coverOpen, closedWidth: state.closedCompactWidth, openWidth: state.compactWidth, height: state.compactHeight, motion: rustMotion, native: rustNative }, () => measuredBounds);
        same(rustMotion, state.motionFrameCapacity, 'motion'); same(rustNative, state.nativeMotionCapacity, 'native');
        expect(rust === null).toBe(reference.camera?.isFull === true);
        if (rust) same(rust, { x: reference.x, y: reference.y, width: reference.width, height: reference.height }, 'frame');
      }
    }
  });
});

describe('copy rectangle', () => {
  it('equals the original for 300000 random frames', () => {
    let rectangles = 0, everything = 0;
    for (let n = 0; n < 300000; n++) {
      const state = viewState(), scale = pick([1, .5, 1.3, -1.5, 3, NaN, 0]);
      const frame = { x: pick([0, 0, 16, 64, 100.5, integer(0, 300), NaN]), y: pick([0, 32, 128, integer(0, 600), 1.25]),
        width: pick([state.viewportWidth, 320, 128, integer(1, 500)]), height: pick([state.viewportHeight, 448, 192, integer(1, 900)]) };
      const measuredBounds = bounds(state);
      let a = 0, b = 0;
      const reference = referenceBookView(state, () => { a++; return measuredBounds; }).copyRectangle(frame, { scale });
      const rust = planCopyRectangle({ viewportWidth: state.viewportWidth, viewportHeight: state.viewportHeight, ratio: state.pixelRatio,
        canvasWidth: state.canvas.width, canvasHeight: state.canvas.height, frame, scale }, () => { b++; return measuredBounds; })
        ?? { x: 0, y: 0, width: state.canvas.width, height: state.canvas.height, full: true };
      expect(b, 'measurements').toBe(a);
      same(rust, reference, JSON.stringify({ state, frame, scale, measuredBounds }));
      expect(Boolean(rust.full)).toBe(Boolean(reference.full));
      if (reference.full) everything++; else rectangles++;
    }
    expect(rectangles).toBeGreaterThan(5000); expect(everything).toBeGreaterThan(5000);
  }, 120000);
});

describe('pose', () => {
  it('places the model like the original for 200000 random poses', () => {
    const value = () => rng() < .15 ? pick([undefined, null, NaN, Infinity, -0, 0, 1, -1, 2]) : pick([0, .5, 1, -3, 12.5, 90, 180, 76, 9, rng() * 400 - 200, rng()]);
    for (let n = 0; n < 200000; n++) {
      const state = viewState();
      const pose = { x: value(), y: value(), scale: value(), angle: value(), pitch: value(), roll: value(), coverOpen: value(), bookmarkWithdraw: value() };
      if (rng() < .5) pose.pageTheme = pick([undefined, null, 0, 1, .5, -1, 2, NaN, '0.25', 'x', Infinity, -0]);
      if (rng() < .15) delete pose[pick(Object.keys(pose))];
      state.current = rng() < .8 ? { coverOpen: value(), bookmarkWithdraw: value() } : undefined;
      const rustCurrent = state.current && { ...state.current }, rustTheme = state.pageTheme;
      const reference = referenceBookView(state, () => []);
      const positioned = reference.positionModel(pose);
      const placed = planBookPose(pose, rustCurrent, state.centerX, state.centerY, state.viewportWidth, state.viewportHeight, rustTheme);
      // A pose without a scale sets undefined (or null) on the model's scale; the core hands over NaN (or 0): the same arithmetic.
      const scaled = value => value === undefined ? NaN : value === null ? 0 : value;
      same([placed.opening, placed.withdrawal, placed.x, placed.y, placed.rotationX, placed.rotationY, placed.rotationZ, placed.scale],
        [positioned.opening, positioned.withdrawal, ...positioned.position.slice(0, 2), ...positioned.rotation, scaled(positioned.scale)], JSON.stringify({ pose, current: state.current }));
      // draw()'s normalisation of the same pose, from the same previous state.
      const drawn = referenceBookView({ ...state, current: rustCurrent && { ...rustCurrent }, pageTheme: rustTheme }, () => []);
      const normalised = drawn.drawPose(pose);
      same(placed.pageTheme, normalised.current.pageTheme, 'page theme');
      same([placed.opening, placed.withdrawal], [normalised.current.coverOpen, normalised.current.bookmarkWithdraw], 'normalised');
      same([placed.x, placed.y, placed.rotationX, placed.rotationY, placed.rotationZ, placed.scale],
        [...normalised.placed.position.slice(0, 2), ...normalised.placed.rotation, scaled(normalised.placed.scale)], 'placed from the normalised pose');
    }
  });
});

describe('fit, reading pose', () => {
  it('fit a cover image like the original', () => {
    for (let n = 0; n < 100000; n++) {
      const values = Array.from({ length: 4 }, () => rng() < .08 ? pick([0, NaN, Infinity, -1, undefined, '5']) : pick([1, 132, 200, 800, 1200.5, rng() * 2000]));
      same(fitCoverImage(...values), referenceFitCoverImage(...values), values.join());
      same(fitImage(...values), referenceFitCoverImage(...values), values.join());
    }
  });
  it('plan the whole spread like the original', () => {
    for (let n = 0; n < 100000; n++) {
      const input = { width: pick([132, 290, 62.125, rng() * 500]), height: pick([200, 440, rng() * 700]), thickness: rng() < .15 ? undefined : pick([0, 48, rng() * 120, NaN]),
        viewportWidth: pick([320, 390, 844, 1280, rng() * 1500]), viewportHeight: pick([568, 844, 390, 800, rng() * 1500]),
        centerX: pick([0, 83.2, 195, rng() * 900]), centerY: pick([0, 150, 350, rng() * 900]) };
      if (rng() < .05) input[pick(Object.keys(input))] = odd();
      same(planReadingBookPose(input), referencePlanReadingBookPose(input), JSON.stringify(input));
      expect(Object.keys(planReadingBookPose(input))).toEqual(Object.keys(referencePlanReadingBookPose(input)));
    }
  });
});

// Real Three objects, so the projection really goes through the camera and world matrices.
function scene() {
  const model = new THREE.Group();
  const meshes = {};
  for (const name of ['front-cover', 'back-cover', 'binding']) {
    if (name === 'back-cover' && rng() < .15) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(rng() * 200 + 1, rng() * 300 + 1, rng() * 40 + 1), new THREE.MeshBasicMaterial());
    mesh.name = name; mesh.position.set(rng() * 100 - 50, rng() * 100 - 50, rng() * 20 - 10); mesh.rotation.set(rng(), rng(), rng());
    if (rng() < .3) mesh.scale.set(rng() * 2 + .1, rng() * 2 + .1, rng() * 2 + .1);
    if (rng() < .2 && name === 'binding') mesh.geometry.boundingBox = null;
    model.add(mesh); meshes[name] = mesh;
  }
  const fit = { width: rng() * 300 + 10, height: rng() * 400 + 10 };
  const page = new THREE.Mesh(new THREE.PlaneGeometry(fit.width, fit.height), new THREE.MeshBasicMaterial());
  page.position.set(rng() * 30, rng() * 30, rng() * 10); page.visible = rng() < .9;
  model.add(page); model.userData.pageSurface = rng() < .95 ? page : undefined;
  model.position.set(rng() * 300 - 150, rng() * 300 - 150, 0);
  model.rotation.set(rng() * Math.PI, rng() * Math.PI * 2, rng());
  model.scale.setScalar(rng() < .5 ? 1 : rng() * 2 + .2);
  const viewportWidth = integer(200, 1400), viewportHeight = integer(200, 1400);
  const camera = rng() < .7 ? new THREE.OrthographicCamera(-viewportWidth / 2, viewportWidth / 2, viewportHeight / 2, -viewportHeight / 2, .1, 10000)
    : new THREE.PerspectiveCamera(pick([20, 45, 75]), viewportWidth / viewportHeight, .1, 10000);
  camera.position.set(rng() * 40 - 20, rng() * 40 - 20, rng() < .7 ? 3000 : 400 + rng() * 800);
  if (rng() < .3) camera.lookAt(rng() * 50, rng() * 50, 0);
  if (rng() < .2) camera.setViewOffset(viewportWidth, viewportHeight, integer(0, 40), integer(0, 40), integer(100, viewportWidth), integer(100, viewportHeight));
  model.updateMatrixWorld(true);
  return { model, camera, viewportWidth, viewportHeight };
}

describe('projection with real Three objects', () => {
  it('projects the page and the boards like the original on 5000 random scenes', () => {
    let pages = 0, boards = 0, zooms = 0;
    for (let n = 0; n < 5000; n++) {
      const { model, camera, viewportWidth, viewportHeight } = scene();
      const offset = rng() < .5 ? undefined : { left: rng() * 100 - 20, top: rng() * 100 };
      const page = model.userData.pageSurface;
      const expected = referenceProjectBookPageBounds(page, camera, viewportWidth, viewportHeight, offset);
      const actual = projectBookPageBounds(page, camera, viewportWidth, viewportHeight, offset);
      expect(actual === null).toBe(expected === null);
      if (expected) { same(actual, expected, 'page bounds'); pages++; }
      same(projectBookBoardBounds(model, camera, viewportWidth, viewportHeight), referenceProjectBookBoardBounds(model, camera, viewportWidth, viewportHeight), 'board bounds');
      boards++;
      const options = { viewportWidth, viewportHeight, centerX: rng() * viewportWidth, centerY: rng() * viewportHeight,
        origin: { x: rng() * 100 - 50, y: rng() * 100 - 50, scale: rng() * 2 + .1, angle: 76, pitch: 9, roll: 0, coverOpen: .4, bookmarkWithdraw: 1, pageTheme: .5 },
        offset: rng() < .3 ? undefined : { left: rng() * 50, top: rng() * 50 },
        target: pick([{ left: rng() * 20, top: rng() * 60, width: rng() * 400 + 1, height: rng() * 700 + 1 }, { left: 0, top: 0, width: 0, height: 10 }, undefined, { left: 0, top: 0, width: NaN, height: 5 }]) };
      if (options.offset === undefined) delete options.offset;
      const wanted = referencePlanBookPageZoom(model, camera, options), got = planBookPageZoom(model, camera, options);
      expect(got === null).toBe(wanted === null);
      if (wanted) { same(got, wanted, 'zoom'); expect(Object.keys(got)).toEqual(Object.keys(wanted)); zooms++; }
    }
    expect(pages).toBeGreaterThan(3000); expect(zooms).toBeGreaterThan(1000);
  });

  it('measures a box exactly like Vector3.project on its eight corners', () => {
    for (let n = 0; n < 5000; n++) {
      const { model, camera, viewportWidth, viewportHeight } = scene();
      const box = new THREE.Box3().setFromObject(model);
      const reference = [Infinity, Infinity, -Infinity, -Infinity], point = new THREE.Vector3();
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        point.set(x, y, z).project(camera);
        const px = (point.x + 1) * viewportWidth / 2, py = (1 - point.y) * viewportHeight / 2;
        reference[0] = Math.min(reference[0], px); reference[2] = Math.max(reference[2], px);
        reference[1] = Math.min(reference[1], py); reference[3] = Math.max(reference[3], py);
      }
      same(boxScreenBounds([{ min: box.min, max: box.max }], camera, viewportWidth, viewportHeight), reference, 'box');
    }
    const { camera } = scene();
    same(boxScreenBounds([], camera, 100, 100), [Infinity, Infinity, -Infinity, -Infinity], 'nothing');
  });

  it('does not let a measurement taken in the middle of a plan overwrite the plan', () => {
    const { model, camera, viewportWidth, viewportHeight } = scene();
    const inner = () => { projectBookBoardBounds(model, camera, viewportWidth, viewportHeight); planPageBounds(10, 20, 30, 40, { left: 1, top: 2 }, model.matrixWorld.elements, camera);
      planBookView({ shelf: true, devicePixelRatio: 2, innerWidth: 500, viewportWidth: 10, viewportHeight: 20, width: 1, height: 2, thickness: 3 });
      return [10, 20, 300, 400]; };
    const input = { compact: true, direct: true, adaptive: true, measureOnly: false, scale: 1, ratio: 2, viewportWidth: 390, viewportHeight: 844, coverOpen: 1,
      closedWidth: 192, openWidth: 576, height: 448, motion: { width: 0, height: 0 }, native: null };
    const quiet = planReturnFrame({ ...input, motion: { width: 0, height: 0 } }, () => [10, 20, 300, 400]);
    expect(planReturnFrame(input, inner)).toEqual(quiet);
  });
});

describe('memory', () => {
  it('survives memory growth between and during plans', () => {
    const core = getRustCore();
    const input = () => ({ compact: true, direct: true, adaptive: true, measureOnly: false, scale: 1, ratio: 2, viewportWidth: 390, viewportHeight: 844, coverOpen: 1,
      closedWidth: 192, openWidth: 576, height: 448, motion: { width: 0, height: 0 }, native: { width: 64, height: 64 } });
    const first = planReturnFrame(input(), () => [10, 20, 300, 400]);
    core.memory.grow(1);
    expect(planReturnFrame(input(), () => [10, 20, 300, 400])).toEqual(first);
    expect(planReturnFrame(input(), () => { core.memory.grow(1); return [10, 20, 300, 400]; })).toEqual(first);
    expect(planPageZoom({ left: 0, top: 0, width: 100, height: 200 }, { left: 0, top: 0, width: 50, height: 50 }, { left: 0, top: 0 }, 10, 10, { x: 0, y: 0, scale: 1 })).not.toBeNull();
    expect(planReadingPose(100, 200, 10, 390, 844, 100, 100).scale).toBeGreaterThan(0);
  });
  it('allocates nothing per call', () => {
    const core = getRustCore();
    planBookPose({ x: 1, y: 2, scale: 1, angle: 0 }, undefined, 0, 0, 100, 100, 1);
    const size = core.memory.buffer.byteLength;
    for (let n = 0; n < 200000; n++) {
      planBookPose({ x: n, y: 2, scale: 1, angle: 0 }, undefined, 0, 0, 100, 100, 1);
      planReturnFrame({ compact: true, direct: true, adaptive: true, measureOnly: true, scale: 1, ratio: 2, viewportWidth: 390, viewportHeight: 844, coverOpen: 1,
        closedWidth: 192, openWidth: 576, height: 448, motion: null, native: null }, () => [10, 20, 300, 400]);
    }
    expect(core.memory.buffer.byteLength).toBe(size);
  });
});
