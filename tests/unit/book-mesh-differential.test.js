// The page block, the read leaves, both endpapers, the binding and the ribbon are single calls of the shelf
// module (rust-ui/src/book_mesh.rs). This is the guard that let src/js/{page-mesh,binding,bookmark}-wasm.js go:
// every production mesh is compared with the frozen bridges to the numeric core
// (helpers/reference-{page-mesh,binding,bookmark}-wasm.js), byte for byte, attribute for attribute.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { rustCore as core } from './helpers/rust-core-ready.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { bindingGeometry, bookmarkGeometry, leafStackGeometry, pageBlockGeometry } from '../../src/js/book-model.js';
import { rustBookPaperBuffers, rustLeafStackBuffers, rustPageBlockBuffers } from './helpers/reference-page-mesh-wasm.js';
import { createBindingRelief, rustBindingBuffers } from './helpers/reference-binding-wasm.js';
import { rustBookmarkBuffers } from './helpers/reference-bookmark-wasm.js';
import { paperMeshCases } from '../helpers/page-mesh-cases.mjs';

const shelf = needRustShelf();
const raw = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function exact(actual, expected, label) {
  expect(actual.constructor, `${label} type`).toBe(expected.constructor);
  expect(actual.length, `${label} length`).toBe(expected.length);
  expect(Buffer.compare(raw(actual), raw(expected)), `${label} bytes`).toBe(0);
}
/** A production geometry against the frozen bridge's buffers. */
function sameMesh(geometry, buffers, label, { colours = false, groups = [], version = 0 } = {}) {
  expect(geometry.type, label).toBe('BufferGeometry');
  expect(Object.keys(geometry.attributes), `${label} attribute order`).toEqual(colours ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv']);
  for (const [name, key, size] of [['position', 'positions', 3], ['normal', 'normals', 3], ['uv', 'uvs', 2], ...(colours ? [['color', 'colors', 3]] : [])]) {
    const attribute = geometry.getAttribute(name);
    expect(attribute.constructor, `${label} ${name}`).toBe(THREE.BufferAttribute);
    expect(attribute.itemSize, `${label} ${name}`).toBe(size);
    exact(attribute.array, buffers[key], `${label} ${name}`);
  }
  exact(geometry.index.array, buffers.indices, `${label} index`);
  expect(geometry.groups, `${label} groups`).toEqual(groups);
  expect(geometry.getAttribute('normal').version, `${label} normal version`).toBe(version);
  expect(geometry.getAttribute('position').version, label).toBe(0);
}
const grouped = buffers => buffers.groups.map(group => ({ ...group }));

describe('book meshes of the shelf module against the frozen bridges to the numeric core', () => {
  for (const item of paperMeshCases) it(`${item.name}: every attribute, the index and the groups`, () => {
    const { width, height, depth, options } = item;
    const [production, frozen] = item.kind === 'block'
      ? [pageBlockGeometry(width, height, depth, options), rustPageBlockBuffers(core, width, height, depth, options)]
      : [leafStackGeometry(width, height, depth, options), rustLeafStackBuffers(core, width, height, depth, options)];
    sameMesh(production, frozen, item.name, { colours:true, groups:grouped(frozen) });
  });

  it('page blocks and leaf stacks over a sweep of sizes, and the sizes neither takes', () => {
    let seed = 7;
    const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 4294967296;
    for (let i = 0; i < 400; i++) {
      const width = 40 + random() * 400, height = 60 + random() * 500, depth = 2 + random() * 140, detail = random() < .5;
      const options = random() < .3 ? { board:random() * 4, inset:random() * 5, detail } : { detail };
      const block = rustPageBlockBuffers(core, width, height, depth, options);
      if (block) sameMesh(pageBlockGeometry(width, height, depth, options), block, `block ${i}`, { colours:true, groups:grouped(block) });
      else expect(() => pageBlockGeometry(width, height, depth, options)).toThrow(RangeError);
      const leaves = { board:options.board, inset:options.inset, columns:1 + Math.floor(random() * 40) }, read = depth * random();
      const stack = rustLeafStackBuffers(core, width, height, read, leaves);
      if (stack) sameMesh(leafStackGeometry(width, height, read, leaves), stack, `stack ${i}`, { colours:true, groups:grouped(stack) });
      else expect(() => leafStackGeometry(width, height, read, leaves)).toThrow(RangeError);
    }
    for (const [width, height, depth, options] of [[0, 200, 40, {}], [132, -1, 40, {}], [132, 200, NaN, {}], [132, 200, 40, { board:-1 }],
      [Infinity, 200, 40, {}], [132, 200, 40, { inset:NaN }]]) {
      expect(rustPageBlockBuffers(core, width, height, depth, options), 'frozen block').toBeNull();
      expect(() => pageBlockGeometry(width, height, depth, options)).toThrow(RangeError);
    }
    for (const columns of [0, 513, 2.5, NaN, -3, Infinity]) {
      expect(rustLeafStackBuffers(core, 264, 400, 40, { columns })).toBeNull();
      expect(() => leafStackGeometry(264, 400, 40, { columns })).toThrow(RangeError);
    }
    for (const [width, height, depth] of [[0, 400, 40], [264, NaN, 40], [264, 400, -1]]) {
      expect(rustLeafStackBuffers(core, width, height, depth), `${width} ${height} ${depth}`).toBeNull();
      expect(() => leafStackGeometry(width, height, depth)).toThrow(RangeError);
    }
  });

  it('both endpapers as two records of one transfer', () => {
    const read = (data, at) => {
      const vertices = data[at], count = data[at + 1];
      let byte = (at + 8) * 4;
      const floats = size => { const array = new Float32Array(data.buffer, byte, vertices * size); byte += array.byteLength; return array; };
      return { flags:data[at + 2], positions:floats(3), normals:floats(3), uvs:floats(2), colors:floats(3), indices:new Uint16Array(data.buffer, byte, count), next:at + data[at + 7] };
    };
    for (const overview of [false, true]) for (const [pw, ph, gw, gh, inset] of [[120, 188, 128, 196, 1.8], [250.5, 380.25, 256.8, 392.8, 3.6],
      [61.2, 88.1, 60.4, 90.7, .83], [380, 220, 395, 235, 0]]) {
      const frozen = rustBookPaperBuffers(core, pw, ph, gw, gh, inset, overview), data = shelf.book_mesh_paper_planes(pw, ph, gw, gh, inset, overview);
      const pastedown = read(data, 0), paper = read(data, pastedown.next);
      expect(paper.next).toBe(data.length);
      for (const [made, expected] of [[pastedown, frozen.pastedown], [paper, frozen.paper]]) {
        expect(made.flags).toBe(2);
        for (const key of ['positions', 'normals', 'uvs', 'colors', 'indices']) exact(made[key], expected[key], key);
      }
    }
    for (const sizes of [[0, 188, 128, 196, 1.8], [120, 188, 128, NaN, 1.8], [120, 188, 128, 196, -1]]) {
      expect(rustBookPaperBuffers(core, ...sizes, false)).toBeNull();
      expect(shelf.book_mesh_paper_planes(...sizes, false).length).toBe(0);
    }
  });

  it('the binding without relief, with a raster relief and with any sampler, in the sampler\'s own order', () => {
    const sizes = [[132, 200, 40], [264, 400, 80], [62.125, 92.375, 8.25], [400, 240, 120]];
    for (const [width, height, thickness] of sizes) for (const segments of [1, 2, 12, 24, 96, 512])
      sameMesh(bindingGeometry(width, height, thickness, segments), rustBindingBuffers(core, width, height, thickness, segments), `plain ${segments}`);
    const pixels = new Uint8ClampedArray(256 * 1024 * 4);
    let seed = 99;
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) >>> 24;
    const frozenSample = createBindingRelief(core, pixels);
    const sample = Object.assign((u, v) => pixels[shelf.book_mesh_relief_index(u, v, 256, 1024)] / 255, { pixels });
    for (const u of [0, .1, .25, .5, .999, 1]) for (const v of [0, .3, .77, 1]) expect(Object.is(sample(u, v), frozenSample(u, v))).toBe(true);
    for (const [segments, rows] of [[96, 384], [24, 96], [12, 17], [170, 384], [96, 1024]]) {
      const frozen = rustBindingBuffers(core, 132, 200, 40, segments, frozenSample, rows);
      sameMesh(bindingGeometry(132, 200, 40, segments, sample, rows), frozen, `raster ${segments}x${rows}`, { version:1 });
      expect(frozen.indices.constructor, `${segments}x${rows}`).toBe((segments + 1) * (rows + 1) - 1 >= 65535 ? Uint32Array : Uint16Array);
    }
    sameMesh(bindingGeometry(132, 200, 40, 96, Object.assign(() => 0, { pixels:new Uint8Array(pixels.buffer) }), 384),
      rustBindingBuffers(core, 132, 200, 40, 96, frozenSample, 384), 'Uint8Array raster', { version:1 });
    const order = { production:[], frozen:[] };
    const wave = list => (u, v) => { list.push(u, v); return Math.sin(u * 9) * Math.cos(v * 5); };
    const frozen = rustBindingBuffers(core, 264, 400, 80, 12, wave(order.frozen), 17);
    sameMesh(bindingGeometry(264, 400, 80, 12, wave(order.production), 17), frozen, 'sampler', { version:1 });
    expect(order.production).toEqual(order.frozen);
    // A sampler may build another binding while this one is being sampled, and may throw.
    let nested;
    const outer = bindingGeometry(132, 200, 40, 12, (u, v) => { nested ||= bindingGeometry(264, 400, 80, 96, sample, 384); return u * v; }, 17);
    sameMesh(outer, rustBindingBuffers(core, 132, 200, 40, 12, (u, v) => u * v, 17), 'outer', { version:1 });
    sameMesh(nested, rustBindingBuffers(core, 264, 400, 80, 96, frozenSample, 384), 'nested', { version:1 });
    const failure = new Error('sampler failed');
    expect(() => bindingGeometry(132, 200, 40, 96, () => { throw failure; }, 384)).toThrow(failure);
    expect(() => bindingGeometry(132, 200, 40, 96, Object.assign(() => 0, { pixels:new Uint8Array(16) }), 384)).toThrow('Native binding relief rejected');
    for (const args of [[0, 200, 40], [132, NaN, 40], [132, 200, -1], [132, 200, 40, 0], [132, 200, 40, 513], [132, 200, 40, 2.5],
      [132, 200, 40, 96, sample, 0], [132, 200, 40, 96, sample, 1025], [132, 200, 40, 512, sample, 1024], [132, 200, 40, 96, {}, 384], [132, 200, 40, 96, 7, 384]]) {
      expect(rustBindingBuffers(core, ...args), JSON.stringify(args.slice(0, 4))).toBeNull();
      expect(() => bindingGeometry(...args)).toThrow(RangeError);
    }
  });

  it('the ribbon at every pose, both policies, with buffers reused and remade', () => {
    const poses = [[0, 0], [.05, 0], [.050001, 0], [.15, 0], [.3, 0], [.55, 0], [.85, 0], [1, 0], [1, .35], [1, .82], [1, 1], [.6, .1], [0, .7], [-.2, 1.2]];
    const fixtures = [[132, 200, 40, 10, 8, 0], [132, 200, 12, 20, 32, 1], [264, 400, 80, 16, 32, 12345], [90, 240, 15, 0, 16, 4294967295],
      [400, 240, 120, 12, 64, 27], [62.125, 92.375, 8.25, 23, 32, 65520], [132, 200, 40, 10, 4, 300], [132, 200, 40, 10, 9, 65522],
      [132, 200, 40, 10, undefined, 5], [132, 200, 40, 10, 256, 5], [132, 200, 40, 10, 0, 5], [132, 200, 40, 10, '16', 5]];
    for (const legacy of [false, true]) for (const [width, height, thickness, peek, segments, seed] of fixtures) {
      let geometry;
      for (const progress of [0, .45, 1]) for (const [open, withdraw] of poses) {
        const frozen = rustBookmarkBuffers(core, width, height, thickness, progress, peek, open, withdraw, segments, seed, legacy);
        const made = bookmarkGeometry(width, height, thickness, progress, peek, { open, withdraw, segments, seed, legacy, geometry });
        if (geometry) expect(made, 'the flight keeps its geometry').toBe(geometry);
        geometry = made;
        const label = `${legacy ? 'legacy' : 'refined'} ${segments} ${progress} ${open} ${withdraw}`;
        for (const [name, key] of [['position', 'positions'], ['uv', 'uvs'], ['normal', 'normals']]) {
          expect(made.getAttribute(name).constructor, label).toBe(THREE.Float32BufferAttribute);
          exact(made.getAttribute(name).array, frozen[key], `${label} ${name}`);
        }
        expect(made.index.constructor, label).toBe(THREE.Uint16BufferAttribute);
        exact(made.index.array, frozen.indices, `${label} index`);
        expect(Object.keys(made.attributes), label).toEqual(['position', 'uv', 'normal']);
      }
      const fresh = bookmarkGeometry(width, height, thickness, .5, peek, { segments, seed, legacy });
      expect(fresh).not.toBe(geometry);
      expect(fresh.getAttribute('position').array.buffer.byteLength, 'owned, not a view of the module').toBe(fresh.getAttribute('position').array.byteLength);
    }
    for (const args of [[0, 200, 40, .5], [132, 200, 40, NaN], [132, Infinity, 40, .5], [132, 200, 40, .5, NaN], [132, 200, 40, .5, 10, { segments:600 }],
      [132, 200, 40, .5, 10, { seed:NaN }], [132, 200, 40, .5, 10, { open:Infinity }]]) {
      const [width, height, thickness, progress, peek = 10, { open = 0, withdraw = 0, segments = 32, seed = 0 } = {}] = args;
      expect(rustBookmarkBuffers(core, width, height, thickness, progress, peek, open, withdraw, segments, seed), JSON.stringify(args)).toBeNull();
      expect(() => bookmarkGeometry(...args)).toThrow(RangeError);
    }
  });

  it('a ribbon survives the growth of the module\'s memory between frames', () => {
    const geometry = bookmarkGeometry(264, 400, 80, .45, 16, { segments:32, seed:12345 });
    const memory = shelf.book_mesh_memory(), before = memory.buffer;
    memory.grow(1);
    expect(memory.buffer).not.toBe(before);
    const next = bookmarkGeometry(264, 400, 80, .45, 16, { open:.6, withdraw:.1, segments:32, seed:12345, geometry });
    expect(next).toBe(geometry);
    const frozen = rustBookmarkBuffers(core, 264, 400, 80, .45, 16, .6, .1, 32, 12345);
    exact(next.getAttribute('position').array, frozen.positions, 'position after growth');
    exact(next.getAttribute('normal').array, frozen.normals, 'normal after growth');
  });
});
