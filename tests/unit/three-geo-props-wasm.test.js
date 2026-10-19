// @vitest-environment node
// The generators the wastebasket and the paper catalogue add to the Rust shelf module (capsules, planes, torus
// arcs, bevelled extrusions and creased normals), compared with three.js itself on pseudo-random corpora:
// every attribute byte, the index type and the order of attributes.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { expect, it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { readGeometry } from './helpers/geo-packet.js';
const shelf = needRustShelf();
function random(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function expectSame(packet, geometry, order, label) {
  const actual = readGeometry(packet);
  expect(Object.keys(actual.attributes), label + ' attribute order').toEqual(order);
  expect(Object.keys(geometry.attributes), label + ' three attribute order').toEqual(order);
  for (const name of order) {
    const left = actual.attributes[name].array, right = geometry.attributes[name].array;
    expect(left.length, `${label} ${name} length`).toBe(right.length);
    if (!bytes(left).equals(bytes(right))) for (let i = 0; i < left.length; i++) if (!Object.is(left[i], right[i])) throw Error(`${label} ${name}[${i}] ${left[i]} / ${right[i]}`);
  }
  if (geometry.index) {
    expect(actual.index, label + ' index').not.toBeNull();
    expect(actual.index.constructor, label + ' index type').toBe(geometry.index.array.constructor);
    expect(bytes(actual.index).equals(bytes(geometry.index.array)), label + ' index bytes').toBe(true);
  } else expect(actual.index, label + ' no index').toBeNull();
}
const ORDER = ['position', 'normal', 'uv'];

it('draws capsules of any size and segmentation like CapsuleGeometry', () => {
  const r = random(11);
  for (let trial = 0; trial < 300; trial++) {
    const p = [r() * 50 + .01, trial % 9 === 0 ? 0 : trial % 13 === 0 ? -5 : r() * 120, 1 + Math.floor(r() * 6) + (trial % 4 ? 0 : .6), 3 + Math.floor(r() * 30), 1 + Math.floor(r() * 4)];
    expectSame(shelf.probe_geometry('capsule', p), new THREE.CapsuleGeometry(...p), ORDER, 'capsule ' + p);
  }
  expectSame(shelf.probe_geometry('capsule', [2.3, 44 * .34, 2, 8, 1]), new THREE.CapsuleGeometry(2.3, 44 * .34, 2, 8), ORDER, 'hinge');
});

it('draws planes like PlaneGeometry, including fractional segment counts', () => {
  const r = random(12);
  for (let trial = 0; trial < 300; trial++) {
    const p = [r() * 300 + .01, r() * 300 + .01, 1 + Math.floor(r() * 12) + (trial % 5 ? 0 : .5), 1 + Math.floor(r() * 12)];
    if (trial % 17 === 0) p[0] *= -1;
    expectSame(shelf.probe_geometry('plane', p), new THREE.PlaneGeometry(...p), ORDER, 'plane ' + p);
  }
});

it('draws torus arcs like TorusGeometry', () => {
  const r = random(13);
  for (let trial = 0; trial < 300; trial++) {
    const p = [r() * 120 + .01, r() * 10 + .01, 2 + Math.floor(r() * 10), 3 + Math.floor(r() * 50), trial % 7 === 0 ? Math.PI * 2 : r() * 7];
    expectSame(shelf.probe_geometry('torus_arc', p), new THREE.TorusGeometry(...p), ORDER, 'torus ' + p);
  }
  expectSame(shelf.probe_geometry('torus_arc', [44 * .905, .55, 4, 24, Math.PI * .9]), new THREE.TorusGeometry(44 * .905, .55, 4, 24, Math.PI * .9), ORDER, 'handle');
});

// Outlines made of lines, quadratic and cubic curves, either winding, closed or open.
function outline(r, trial) {
  const commands = [], shape = new THREE.Shape();
  const count = 3 + Math.floor(r() * 9), scale = 2 + r() * 60, clockwise = trial % 2 === 0;
  const point = i => { const angle = (i / count) * Math.PI * 2 * (clockwise ? -1 : 1), radius = scale * (.6 + r() * .4); return [Math.cos(angle) * radius, Math.sin(angle) * radius]; };
  const start = point(0);
  commands.push(0, ...start); shape.moveTo(...start);
  for (let i = 1; i <= count; i++) {
    const end = i === count && trial % 3 !== 0 ? start : point(i % count), kind = Math.floor(r() * 3);
    if (kind === 0) { commands.push(1, ...end); shape.lineTo(...end); }
    else if (kind === 1) { const c = point(i - .5); commands.push(2, ...c, ...end); shape.quadraticCurveTo(...c, ...end); }
    else { const a = point(i - .7), b = point(i - .3); commands.push(3, ...a, ...b, ...end); shape.bezierCurveTo(...a, ...b, ...end); }
  }
  return { commands, shape };
}

it('extrudes bevelled outlines of lines and curves like ExtrudeGeometry, and creases their normals', () => {
  const r = random(14);
  for (let trial = 0; trial < 240; trial++) {
    const { commands, shape } = outline(r, trial);
    const depth = r() * 30 + .1, bevelThickness = r() * 2, bevelSize = r() * 1.5, bevelSegments = 1 + Math.floor(r() * 4), curveSegments = 1 + Math.floor(r() * 8);
    const p = [depth, bevelThickness, bevelSize, bevelSegments, curveSegments, ...commands];
    const reference = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness, bevelSize, bevelSegments, curveSegments });
    expectSame(shelf.probe_geometry('extrude_bevel', p), reference, ['position', 'uv', 'normal'], `extrude ${trial}`);
    expectSame(shelf.probe_geometry('extrude_bevel_creased', p), toCreasedNormals(reference, Math.PI / 4), ['position', 'uv', 'normal'], `creased ${trial}`);
  }
});

it('extrudes the pedal and the clip jaw like the originals', () => {
  for (const radius of [12, 20, 44, 100, 1000]) {
    const pw = radius * .3, pd = radius * .27, shape = new THREE.Shape();
    shape.moveTo(-pw * .8, 0); shape.lineTo(-pw * .94, pd * .7);
    shape.quadraticCurveTo(-pw, pd, -pw * .76, pd); shape.lineTo(pw * .76, pd);
    shape.quadraticCurveTo(pw, pd, pw * .94, pd * .7); shape.lineTo(pw * .8, 0); shape.lineTo(-pw * .8, 0);
    const commands = [0, -pw * .8, 0, 1, -pw * .94, pd * .7, 2, -pw, pd, -pw * .76, pd, 1, pw * .76, pd, 2, pw, pd, pw * .94, pd * .7, 1, pw * .8, 0, 1, -pw * .8, 0];
    const reference = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: true, bevelThickness: .8, bevelSize: .8, bevelSegments: 2, curveSegments: 4 });
    expectSame(shelf.probe_geometry('extrude_bevel', [2.6, .8, .8, 2, 4, ...commands]), reference, ['position', 'uv', 'normal'], `pedal ${radius}`);
  }
});
