import * as THREE from 'three';
import { loadedRustCore } from './rust-core.js';
import { rustShelfOcclusion } from './shelf-occlusion-wasm.js';

/** All timber pieces use the same physical texture scale, in shelf pixels. */
const TIMBER_SCALE = 160;
const BOARD_HEIGHT = 15;
/** The joinery constants (in the numeric core's cabinet module) were tuned at this many
 * pixels per millimetre (a 600 mm cabinet 390 px wide). `scale` builds the same cabinet at
 * any real pixel-per-millimetre size by scaling the finished, merged geometry. */
const REFERENCE_SCALE = 0.65;
const unitFactor = scale => Number.isFinite(scale) && scale > 0 ? scale / REFERENCE_SCALE : 1;
// The core reads numbers only: anything else counts as a missing measure (not finite), as `Number.isFinite` does.
const num = value => typeof value === 'number' ? value : NaN;
const bottomsOf = rows => (Array.isArray(rows) ? rows : []).map(row => num(row?.bottom));
const MESH_NAMES = ['Recessed timber back', 'Cabinet joinery', 'Shelf timber and rounded fronts'];
const ATTRIBUTES = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]];
const FLOATS_PER_BEAM = 132 * 11, TABLE_HEAD = 12;

/** The cabinet's beams, lips and planks, drawn and merged by material in the numeric core.
 * `ids` tell which of the wood, back and trim roles share a material. */
function buildCabinet(width, height, depth, rows, ids) {
  const core = loadedRustCore(), bottoms = bottomsOf(rows);
  // 20 fixed beams at most, plus board, lip and back rail for every shelf.
  const beams = 21 + 3 * bottoms.length, nameBytes = beams * 32;
  const input = 6 + bottoms.length, tableAt = input, outAt = tableAt + TABLE_HEAD + 6 * beams;
  const namesAt = outAt + beams * FLOATS_PER_BEAM / 2, length = namesAt + Math.ceil(nameBytes / 8);
  const pointer = core.alloc_f64(length);
  if (!pointer) throw new Error('El módulo numérico no pudo reservar memoria.');
  try {
    new Float64Array(core.memory.buffer, pointer, input).set([num(width), num(height), num(depth), ...ids, ...bottoms]);
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

/**
 * Cabinet coordinates match the shelf scene: x is centred, y grows upward,
 * and its front is z=0. Books stand at y=-row.bottom. All shared materials
 * remain the caller's property. Three merged meshes keep the cost steady
 * even when the library has a hundred shelves.
 */
export function createShelfFurniture({ width, height, depth, rows = [], wood, backWood, darkWood, scale }) {
  const factor = unitFactor(scale);
  if (factor !== 1) {
    // Build in reference units, then scale the finished group about its
    // top-centre-front origin: joinery, grain and bevels keep their look.
    const inside = createShelfFurniture({ width:width / factor, height:height / factor, depth:depth / factor,
      rows:(Array.isArray(rows) ? rows : []).map(row => ({ ...row, bottom:row?.bottom / factor })), wood, backWood, darkWood });
    inside.scale.setScalar(factor);
    inside.userData.scale = factor;
    return inside;
  }
  if (!wood && !backWood && !darkWood) throw new TypeError('createShelfFurniture requires a shared wood material');
  const materials = [wood || darkWood || backWood, backWood || wood || darkWood, darkWood || wood || backWood];
  const group = new THREE.Group();
  group.name = 'Walnut cabinet';
  group.userData.furniture = true;
  // Equal materials are one batch: the core receives an id per role, the first of its kind.
  const unique = [...new Set(materials)];
  const { parts, groups } = buildCabinet(width, height, depth, rows, materials.map(material => unique.indexOf(material)));
  const ownedGeometries = [];
  for (const { geometry, name, material } of groups) {
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, unique[material]);
    mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.parts = parts;
  group.userData.boardHeight = BOARD_HEIGHT;
  group.userData.textureScale = TIMBER_SCALE;
  let disposed = false;
  group.userData.disposeGeometry = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of ownedGeometries) geometry.dispose();
  };
  return group;
}

/**
 * Baked ambient occlusion and floor contact, as one unlit, transparent
 * geometry (RGBA vertex colours, black with falloff): inner corners of every
 * compartment, the band where books meet the back, and soft floor shadows
 * under the cabinet and under any freestanding objects (`footprints`, e.g.
 * the wastebasket: { x, z, radius }). Draw with a MeshBasicMaterial that has
 * vertexColors, transparent and depthWrite:false. About 26 triangles a row,
 * plus 22 for the floor contact and the sides' fade toward it. `floorLight`
 * ([r, g, b, alpha], linear) adds a faint pool of light on the floor first,
 * for a near-black page where a shadow alone has nothing to darken (120 more).
 */
export function createShelfOcclusion({ scale, ...options }) {
  const factor = unitFactor(scale);
  if (factor === 1) return buildShelfOcclusion(options);
  const geometry = buildShelfOcclusion({ ...options, width:options.width / factor, height:options.height / factor,
    depth:options.depth / factor, floorY:options.floorY / factor,
    rows:(Array.isArray(options.rows) ? options.rows : []).map(row => ({ ...row, bottom:row?.bottom / factor })),
    footprints:(options.footprints || []).map(({ x, z, radius }) => ({ x:x / factor, z:z / factor, radius:radius / factor })) });
  geometry.scale(factor, factor, factor);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function buildShelfOcclusion({ width, height, depth, rows = [], floorY, footprints = [], floorLight = null }) {
  return rustShelfOcclusion(num(width), num(height), num(depth), num(floorY), bottomsOf(rows), footprints, floorLight);
}
