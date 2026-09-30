import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** All timber pieces use the same physical texture scale, in shelf pixels. */
const TIMBER_SCALE = 160;
const BOARD_HEIGHT = 15;
const validDimension = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

function textureOffset(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return [((hash >>> 8) % 1009) / 109, ((hash >>> 18) % 1013) / 113];
}

function geometryBuilder(grainAxis, seed) {
  const positions = [], normals = [], uvs = [];
  const offset = textureOffset(seed);
  const uv = (point, normal) => {
    // Side grain follows the length of each cut board. The end of a board
    // instead uses its two cross-section coordinates, without stretching.
    let first = grainAxis;
    const dominant = Math.abs(normal[0]) > Math.abs(normal[1])
      ? (Math.abs(normal[0]) > Math.abs(normal[2]) ? 0 : 2)
      : (Math.abs(normal[1]) > Math.abs(normal[2]) ? 1 : 2);
    if (dominant === first) first = (first + 1) % 3;
    const second = [0, 1, 2].find(axis => axis !== first && axis !== dominant);
    return [point[first] / TIMBER_SCALE + offset[0], point[second] / TIMBER_SCALE + offset[1]];
  };
  const triangle = (a, b, c, preferredNormal) => {
    const ab = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
    const ac = new THREE.Vector3().fromArray(c).sub(new THREE.Vector3().fromArray(a));
    const normal = ab.cross(ac).normalize();
    if (preferredNormal && normal.dot(new THREE.Vector3().fromArray(preferredNormal)) < 0) {
      [b, c] = [c, b]; normal.negate();
    }
    const direction = normal.toArray();
    for (const point of [a, b, c]) {
      positions.push(...point); normals.push(...direction); uvs.push(...uv(point, direction));
    }
  };
  return {
    triangle,
    polygon(points, outward) {
      for (let index = 1; index < points.length - 1; index += 1) triangle(points[0], points[index], points[index + 1], outward);
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return geometry;
    }
  };
}

/** Six broad faces, twelve actual bevel faces and eight cut corners. */
function chamferedTimber(width, height, depth, bevel, grainAxis, seed) {
  const half = [width / 2, height / 2, depth / 2];
  const radius = Math.max(0.01, Math.min(bevel, ...half.map(value => value * 0.45)));
  const core = half.map(value => value - radius);
  const builder = geometryBuilder(grainAxis, seed);
  for (let axis = 0; axis < 3; axis += 1) {
    const [a, b] = [0, 1, 2].filter(other => other !== axis);
    for (const sign of [-1, 1]) {
      const outward = [0, 0, 0]; outward[axis] = sign;
      const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => {
        const point = [0, 0, 0];
        point[axis] = half[axis] * sign; point[a] = core[a] * sa; point[b] = core[b] * sb;
        return point;
      });
      builder.polygon(points, outward);
    }
  }
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const along = [0, 1, 2].find(axis => axis !== a && axis !== b);
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const outward = [0, 0, 0]; outward[a] = sa; outward[b] = sb;
      const points = [[0, -1], [1, -1], [1, 1], [0, 1]].map(([edge, end]) => {
        const point = [0, 0, 0];
        point[a] = sa * (edge ? core[a] : half[a]);
        point[b] = sb * (edge ? half[b] : core[b]);
        point[along] = end * core[along];
        return point;
      });
      builder.polygon(points, outward);
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const signs = [sx, sy, sz];
    const points = [0, 1, 2].map(fullAxis => half.map((value, axis) => signs[axis] * (axis === fullAxis ? value : core[axis])));
    builder.polygon(points, signs);
  }
  return builder.finish();
}

/** A restrained rounded lip, extruded along the shelf, not a painted stripe. */
function shelfLip(width, seed) {
  // Cross section [z, y], with its top exactly at the book's baseline.
  const section = [
    [6.0, 0], [9.1, 0], [10.2, -0.5], [11.1, -1.35], [11.65, -2.5],
    [11.8, -3.9], [11.4, -5.0], [10.65, -5.8], [9.9, -6.25],
    [9.5, -9.0], [9.85, -11.6], [10.35, -13.2], [9.95, -14.35],
    [8.85, -BOARD_HEIGHT], [6.0, -BOARD_HEIGHT]
  ];
  const builder = geometryBuilder(0, seed);
  const contour = section.map(([z, y]) => new THREE.Vector2(z, y));
  const caps = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const side of [-1, 1]) {
    for (const [a, b, c] of caps) builder.triangle(
      [side * width / 2, section[a][1], section[a][0]],
      [side * width / 2, section[b][1], section[b][0]],
      [side * width / 2, section[c][1], section[c][0]], [side, 0, 0]
    );
  }
  for (let index = 0; index < section.length; index += 1) {
    const next = (index + 1) % section.length;
    const [z, y] = section[index], [nz, ny] = section[next];
    const normal = [0, nz - z, y - ny];
    builder.polygon([
      [-width / 2, y, z], [width / 2, y, z],
      [width / 2, ny, nz], [-width / 2, ny, nz]
    ], normal);
  }
  return builder.finish();
}

/**
 * Cabinet coordinates match the shelf scene: x is centred, y grows upward,
 * and its front is z=0. Books stand at y=-row.bottom. All shared materials
 * remain the caller's property. Three merged meshes keep the cost steady
 * even when the library has a hundred shelves.
 */
export function createShelfFurniture({ width, height, depth, rows = [], wood, backWood, darkWood }) {
  const w = validDimension(width, 360), h = validDimension(height, 600), d = validDimension(depth, 155);
  if (!wood && !backWood && !darkWood) throw new TypeError('createShelfFurniture requires a shared wood material');
  const materials = { wood:wood || darkWood || backWood, back:backWood || wood || darkWood, trim:darkWood || wood || backWood };
  const group = new THREE.Group();
  group.name = 'Walnut cabinet';
  group.userData.furniture = true;
  const batches = new Map(), parts = [];
  const add = (geometry, material, name, position) => {
    geometry.translate(...position);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
    parts.push({ name, bounds:geometry.boundingBox.clone() });
  };
  const beam = (name, bw, bh, bd, x, y, z, material = materials.wood, grain = 0, bevel = 0.7) => {
    add(chamferedTimber(bw, bh, bd, bevel, grain, name), material, name, [x, y, z]);
  };
  const inner = Math.max(1, w - 24);
  const side = Math.min(12, w * 0.12);
  const plankCount = Math.max(2, Math.min(12, Math.ceil(inner / 108)));
  const plankWidth = inner / plankCount;
  for (let index = 0; index < plankCount; index += 1) {
    // The physical gaps reveal the darkness behind each tongue-and-groove
    // joint. Separate end bevels also catch a small grazing light.
    beam(`back-plank-${index}`, Math.max(0.2, plankWidth - 0.85), Math.max(1, h - 12), 4,
      -inner / 2 + plankWidth * (index + 0.5), -h / 2, -d, materials.back, 1, 0.35);
  }
  beam('left-upright', side, h, d + 6, -w / 2 + side / 2, -h / 2, -d / 2, materials.trim, 1, 1.0);
  beam('right-upright', side, h, d + 6, w / 2 - side / 2, -h / 2, -d / 2, materials.wood, 1, 1.0);
  // The thin front stiles reveal the cabinet's depth and protect board ends.
  beam('left-front-stile', Math.max(1, side - 2), Math.max(1, h - 4), 5, -w / 2 + side / 2, -h / 2, 5, materials.wood, 1, 0.8);
  beam('right-front-stile', Math.max(1, side - 2), Math.max(1, h - 4), 5, w / 2 - side / 2, -h / 2, 5, materials.wood, 1, 0.8);
  beam('top-cap', w, 12, d + 10, 0, -6, -d / 2 + 3, materials.wood, 0, 0.8);
  beam('top-back-rail', inner, 5, 7, 0, -10, -d + 4, materials.trim, 0, 0.55);

  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Number.isFinite(row?.bottom) || row.bottom < 0 || seen.has(row.bottom)) continue;
    seen.add(row.bottom);
    const name = `shelf-${seen.size - 1}`;
    const shelfWidth = Math.max(1, w - side * 2 + 8);
    beam(`${name}-board`, shelfWidth, BOARD_HEIGHT, d + 8, 0, -row.bottom - BOARD_HEIGHT / 2, -d / 2 + 3,
      materials.wood, 0, 0.65);
    add(shelfLip(shelfWidth, `${name}-lip`), materials.wood, `${name}-lip`, [0, -row.bottom, 0]);
    beam(`${name}-back-rail`, inner, 5, 8, 0, -row.bottom + 2.5, -d + 4, materials.trim, 0, 0.5);
  }

  const ownedGeometries = [];
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    for (const source of geometries) source.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material === materials.back ? 'Recessed timber back' : material === materials.trim ? 'Cabinet joinery' : 'Shelf timber and rounded fronts';
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
