import * as THREE from 'three';
import { loadedRustCore } from './rust-core.js';
import { rustShelfOcclusion } from './shelf-occlusion-wasm.js';

import { needRustShelf } from './rust-shelf.js';

const MESH_NAMES = ['Recessed timber back', 'Cabinet joinery', 'Shelf timber and rounded fronts'];
const ATTRIBUTES = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]];
const FLOATS_PER_BEAM = 132 * 11, TABLE_HEAD = 12;

/** The cabinet's beams, lips and planks, drawn and merged by material in the numeric core.
 * `ids` tell which of the wood, back and trim roles share a material. */
function buildCabinet(width, height, depth, bottoms, ids) {
  const core = loadedRustCore();
  // 20 fixed beams at most, plus board, lip and back rail for every shelf.
  const beams = 21 + 3 * bottoms.length, nameBytes = beams * 32;
  const input = 6 + bottoms.length, tableAt = input, outAt = tableAt + TABLE_HEAD + 6 * beams;
  const namesAt = outAt + beams * FLOATS_PER_BEAM / 2, length = namesAt + Math.ceil(nameBytes / 8);
  const pointer = core.alloc_f64(length);
  if (!pointer) throw new Error('El módulo numérico no pudo reservar memoria.');
  try {
    new Float64Array(core.memory.buffer, pointer, input).set([width, height, depth, ...ids, ...bottoms]);
    const count = core.cabinet_build(pointer, bottoms.length, pointer + outAt * 8, pointer + tableAt * 8, pointer + namesAt * 8, nameBytes);
    if (!count) throw new Error('El módulo numérico no pudo calcular el armario.');
    const buffer = core.memory.buffer, table = new Float64Array(buffer, pointer + tableAt * 8, TABLE_HEAD + 6 * count);
    const names = new TextDecoder().decode(new Uint8Array(buffer, pointer + namesAt * 8, table[2])).split('\n');
    const parts = names.map((name, index) => {
      const at = TABLE_HEAD + index * 6;
      return { name, bounds:new THREE.Box3(new THREE.Vector3(table[at], table[at + 1], table[at + 2]), new THREE.Vector3(table[at + 3], table[at + 4], table[at + 5])) };
    });
    const groups = [];
    let offset = pointer + outAt * 8;
    for (let group = 0; group < table[1]; group++) {
      const vertices = table[3 + group * 3], geometry = new THREE.BufferGeometry();
      for (const [name, size] of ATTRIBUTES) {
        // The attribute owns a copy of its block: nothing keeps a view into WASM memory.
        geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(buffer, offset, vertices * size).slice(), size));
        offset += vertices * size * 4;
      }
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      groups.push({ geometry, name:MESH_NAMES[table[4 + group * 3]], material:table[5 + group * 3] });
    }
    return { parts, groups };
  } finally { core.free_f64(pointer, length); }
}

// Three constructors and typed WASM-buffer access remain host bindings. Rust
// owns units, row normalization, material batches, metadata and disposal.
const host = {
  buildCabinet,
  group: () => new THREE.Group(),
  mesh: (geometry, material) => new THREE.Mesh(geometry, material),
  disposeCallback: state => () => needRustShelf().shelf_furniture_dispose(state),
  occlusion: rustShelfOcclusion,
};

export function createShelfFurniture({ width, height, depth, rows = [], wood, backWood, darkWood, scale }) {
  return needRustShelf().shelf_furniture_create(host, { width, height, depth, rows, wood, backWood, darkWood, scale });
}

export function createShelfOcclusion({ scale, ...options }) {
  return needRustShelf().shelf_furniture_occlusion(host, scale, options);
}
