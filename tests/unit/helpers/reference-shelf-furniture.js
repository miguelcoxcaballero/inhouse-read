import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** All timber pieces use the same physical texture scale, in shelf pixels. */
const TIMBER_SCALE = 160;
const BOARD_HEIGHT = 15;
/** The joinery constants below were tuned at this many pixels per millimetre
 * (a 600 mm cabinet 390 px wide). `scale` builds the same cabinet at any real
 * pixel-per-millimetre size by scaling the finished, merged geometry. */
const REFERENCE_SCALE = 0.65;
const unitFactor = scale => Number.isFinite(scale) && scale > 0 ? scale / REFERENCE_SCALE : 1;
const validDimension = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

function hash(seed) {
  let value = 2166136261;
  for (const character of String(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value;
}

function textureOffset(seed) {
  const value = hash(seed);
  return [((value >>> 8) % 1009) / 109, ((value >>> 18) % 1013) / 113];
}

/** Every board is cut from a slightly different flitch: a small, deterministic
 * shift in value and warmth, carried by vertex colours (no extra draw call). */
function boardTone(seed) {
  const value = hash(`${seed}:tone`);
  const light = .93 + ((value & 255) / 255) * .12, warm = ((value >>> 8 & 255) / 255 - .5) * .06;
  return [light * (1 + warm), light, light * (1 - warm * 1.4)];
}

function geometryBuilder(grainAxis, seed, tone = boardTone(seed)) {
  const positions = [], normals = [], uvs = [], colors = [];
  const offset = textureOffset(seed);
  const uv = (point, normal) => {
    // Side grain follows the length of each cut board. The end of a board
    // instead uses its two cross-section coordinates, without stretching.
    let first = grainAxis;
    const dominant = Math.abs(normal[0]) > Math.abs(normal[1])
      ? (Math.abs(normal[0]) > Math.abs(normal[2]) ? 0 : 2)
      : (Math.abs(normal[1]) > Math.abs(normal[2]) ? 1 : 2);
    const endGrain = dominant === first;
    if (endGrain) first = (first + 1) % 3;
    const second = [0, 1, 2].find(axis => axis !== first && axis !== dominant);
    return { endGrain, uv:[point[first] / TIMBER_SCALE + offset[0], point[second] / TIMBER_SCALE + offset[1]] };
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
      const mapped = uv(point, direction);
      // Open end grain drinks more oil and finishes visibly darker.
      const shade = mapped.endGrain ? .6 : 1;
      positions.push(...point); normals.push(...direction); uvs.push(...mapped.uv);
      colors.push(tone[0] * shade, tone[1] * shade, tone[2] * shade);
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
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return geometry;
    }
  };
}

/** Six broad faces, twelve actual bevel faces and eight cut corners. */
function chamferedTimber(width, height, depth, bevel, grainAxis, seed, tone) {
  const half = [width / 2, height / 2, depth / 2];
  const radius = Math.max(0.01, Math.min(bevel, ...half.map(value => value * 0.45)));
  const core = half.map(value => value - radius);
  const builder = geometryBuilder(grainAxis, seed, tone);
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

/** A solid-wood edge band: flat front, softly rounded top and bottom arrises. */
function shelfLip(width, seed) {
  // Cross section [z, y], with its top exactly at the book's baseline.
  const section = [
    [6.0, 0], [9.0, 0], [10.25, -.3], [11.1, -1.0], [11.55, -2.0], [11.7, -3.2],
    [11.7, -12.2], [11.5, -13.35], [10.9, -14.3], [9.9, -14.85], [8.8, -BOARD_HEIGHT], [6.0, -BOARD_HEIGHT]
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

/** How far the joinery reaches outside the carcase depth, in reference pixels:
 * the back backer 3 behind the back plane, and the shelf lips 11.7 in front of
 * the front plane (z = 0). `cabinetFrame.d` is the carcase depth, so that the
 * cabinet's outer depth (back backer to lip, the Box3 of the group) is exactly
 * the `depth` asked for: a 250 mm unit is 250 mm deep, not 272.6 mm. The front
 * stays where the books stand against the lips; the back panel moves forward. */
const BACK_REACH = 3, FRONT_REACH = 11.7;

/** Shared cabinet measurements, so occlusion follows the real joinery. */
function cabinetFrame(width, height, depth) {
  const w = validDimension(width, 360), h = validDimension(height, 600);
  const d = Math.max(1, validDimension(depth, 155) - BACK_REACH - FRONT_REACH);
  const side = Math.min(12, w * 0.12);
  return { w, h, d, side, inner:Math.max(1, w - 24), shelfWidth:Math.max(1, w - side * 2 + 8) };
}

function shelfBottoms(rows) {
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Number.isFinite(row?.bottom) || row.bottom < 0 || seen.has(row.bottom)) continue;
    seen.add(row.bottom);
  }
  return [...seen];
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
  const { w, h, d, side, inner, shelfWidth } = cabinetFrame(width, height, depth);
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
  const beam = (name, bw, bh, bd, x, y, z, material = materials.wood, grain = 0, bevel = 0.7, tone) => {
    add(chamferedTimber(bw, bh, bd, bevel, grain, name, tone), material, name, [x, y, z]);
  };
  const plankCount = Math.max(2, Math.min(12, Math.ceil(inner / 108)));
  const plankWidth = inner / plankCount;
  // A dark rebated backer behind the tongue-and-groove joints. The page
  // background must never show through a joint, in either theme.
  beam('back-backer', inner + 4, Math.max(1, h - 4), 1, 0, -h / 2, -d - 2.5, materials.back, 1, 0.2, [.2, .15, .11]);
  for (let index = 0; index < plankCount; index += 1) {
    // The physical gaps reveal the darkness behind each tongue-and-groove
    // joint. Separate eased edges also catch a small grazing light.
    beam(`back-plank-${index}`, Math.max(0.2, plankWidth - 0.85), Math.max(1, h - 12), 4,
      -inner / 2 + plankWidth * (index + 0.5), -h / 2, -d, materials.back, 1, 1.1);
  }
  beam('left-upright', side, h, d + 6, -w / 2 + side / 2, -h / 2, -d / 2, materials.trim, 1, 1.4);
  beam('right-upright', side, h, d + 6, w / 2 - side / 2, -h / 2, -d / 2, materials.wood, 1, 1.4);
  // The thin front stiles reveal the cabinet's depth and protect board ends.
  beam('left-front-stile', Math.max(1, side - 2), Math.max(1, h - 4), 5, -w / 2 + side / 2, -h / 2, 5, materials.wood, 1, 1.2);
  beam('right-front-stile', Math.max(1, side - 2), Math.max(1, h - 4), 5, w / 2 - side / 2, -h / 2, 5, materials.wood, 1, 1.2);
  beam('top-cap', w, 12, d + 10, 0, -6, -d / 2 + 3, materials.wood, 0, 1.6);
  beam('top-back-rail', inner, 5, 7, 0, -10, -d + 4, materials.trim, 0, 0.55);

  const bottoms = shelfBottoms(rows);
  bottoms.forEach((bottom, index) => {
    const name = `shelf-${index}`;
    beam(`${name}-board`, shelfWidth, BOARD_HEIGHT, d + 8, 0, -bottom - BOARD_HEIGHT / 2, -d / 2 + 3,
      materials.wood, 0, 0.65);
    add(shelfLip(shelfWidth, `${name}-lip`), materials.wood, `${name}-lip`, [0, -bottom, 0]);
    beam(`${name}-back-rail`, inner, 5, 8, 0, -bottom + 2.5, -d + 4, materials.trim, 0, 0.5);
  });
  // A recessed kick plate turns the open space under the last shelf into a
  // real plinth; its shadow line separates the cabinet from the floor.
  const plinthTop = bottoms.length ? Math.max(...bottoms) + BOARD_HEIGHT : h;
  if (h - plinthTop > 3) beam('plinth', inner + 2, h - plinthTop, 6, 0, -(plinthTop + h) / 2, -2, materials.trim, 0, 0.8);

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
  const { w, h, d, side, inner } = cabinetFrame(width, height, depth);
  const positions = [], colors = [];
  // Pure darkness for every shadow: anything lighter would glow over the
  // dark theme's page. Only the optional floor pool is tinted.
  let ink = [0, 0, 0];
  const vertex = (point, alpha) => { positions.push(...point); colors.push(...ink, alpha); };
  // A quad whose first edge (a, b) is dark and far edge (c, d) is clear.
  const ramp = (a, b, c, e, dark, clear = 0) => {
    for (const [point, alpha] of [[a, dark], [b, dark], [c, clear], [a, dark], [c, clear], [e, clear]]) vertex(point, alpha);
  };
  const back = -d + 2 + .3, left = -inner / 2, right = inner / 2, wallL = -w / 2 + side + .3, wallR = w / 2 - side - .3;
  const bottoms = shelfBottoms(rows).sort((a, b) => a - b);
  let ceiling = -12;
  for (const bottom of bottoms) {
    const floor = -bottom, top = ceiling, rail = floor + 5, lift = floor + .3;
    const tall = Math.max(1, top - floor);
    const under = Math.min(52, tall * .34), above = Math.min(34, tall * .22);
    // Back panel: under the board above, above the rail, and both side corners.
    ramp([left, top, back], [right, top, back], [right, top - under, back], [left, top - under, back], .5);
    ramp([left, rail, back], [right, rail, back], [right, rail + above, back], [left, rail + above, back], .42);
    ramp([left, floor, back], [left, top, back], [left + 30, top, back], [left + 30, floor, back], .34);
    ramp([right, floor, back], [right, top, back], [right - 30, top, back], [right - 30, floor, back], .34);
    // Board top: behind the books and against each upright.
    ramp([left, lift, -d + 8.3], [right, lift, -d + 8.3], [right, lift, -d + 52], [left, lift, -d + 52], .42);
    ramp([wallL, lift, -d], [wallL, lift, 8], [wallL + 20, lift, 8], [wallL + 20, lift, -d], .3);
    ramp([wallR, lift, -d], [wallR, lift, 8], [wallR - 20, lift, 8], [wallR - 20, lift, -d], .3);
    // Inside faces of both uprights: into the back corner, under the ceiling
    // and just above the board.
    for (const x of [wallL, wallR]) {
      ramp([x, floor, -d + 2], [x, top, -d + 2], [x, top, -d + 46], [x, floor, -d + 46], .42);
      ramp([x, top, -d], [x, top, 7], [x, top - under * .8, 7], [x, top - under * .8, -d], .38);
      ramp([x, floor, -d], [x, floor, 7], [x, floor + 22, 7], [x, floor + 22, -d], .3);
    }
    ceiling = floor - BOARD_HEIGHT;
  }
  const ground = (Number.isFinite(floorY) ? floorY : -h) + .25;
  if (Array.isArray(floorLight) && floorLight.length === 4 && floorLight.every(Number.isFinite)) {
    // Lamp light on the floor, brightest against the carcass and gone most of
    // a cabinet depth out in front of its right half and past the bin. The
    // turned view pushes the front-left corner toward a narrow screen's edge,
    // so it stays close there. Rounded corners [x, z, reach x, reach z].
    ink = floorLight.slice(0, 3);
    const corners = [[1, 1, .85, .8], [-1, 1, .06, .3], [-1, -1, .06, .3], [1, -1, .85, .3]];
    const steps = [[0, 1], [.28, .72], [.6, .3], [1, 0]];
    const ring = scale => corners.flatMap(([sx, sz, rx, rz], corner) => Array.from({ length:5 }, (_, k) => {
      const angle = (corner * 4 + k) * Math.PI / 8;
      return [sx * (w / 2 + rx * d * scale * Math.abs(Math.cos(angle))), ground,
        (sz < 0 ? -d - 3 : 8) + sz * rz * d * scale * Math.abs(Math.sin(angle))];
    }));
    for (let step = 0; step < steps.length - 1; step++) {
      const inside = ring(steps[step][0]), outside = ring(steps[step + 1][0]);
      for (let index = 0; index < 20; index++) {
        const next = (index + 1) % 20;
        ramp(inside[index], inside[next], outside[next], outside[index], floorLight[3] * steps[step][1], floorLight[3] * steps[step + 1][1]);
      }
    }
    ink = [0, 0, 0];
  }
  // Floor contact: a dark core just under the carcass, fading outward; a
  // little longer to the right and back, away from the window-side key.
  const rect = (x0, x1, z0, z1) => [[x0, ground, z1], [x1, ground, z1], [x1, ground, z0], [x0, ground, z0]];
  const rings = [
    [rect(-w / 2 + 2, w / 2 - 2, -d - 1, 6), .62],
    [rect(-w / 2 - 4, w / 2 + 14, -d - 14, 15), .26],
    [rect(-w / 2 - 12, w / 2 + 46, -d - 42, 30), 0]
  ];
  const band = ([inside, darkIn], [outside, darkOut]) => {
    for (let corner = 0; corner < 4; corner++) {
      const next = (corner + 1) % 4;
      ramp(inside[corner], inside[next], outside[next], outside[corner], darkIn, darkOut);
    }
  };
  const [core] = rings;
  ramp(core[0][0], core[0][1], core[0][2], core[0][3], core[1], core[1]);
  band(rings[0], rings[1]); band(rings[1], rings[2]);
  // The outer sides lose the floor's bounce just above it: a short fade
  // that seats the carcass on the ground in the isometric view.
  const rise = Math.min(44, h * .12);
  for (const x of [-w / 2 - .3, w / 2 + .3]) ramp([x, ground, -d - 3], [x, ground, 3], [x, ground + rise, 3], [x, ground + rise, -d - 3], .3);
  for (const { x, z, radius } of footprints) {
    if (![x, z, radius].every(Number.isFinite) || radius <= 0) continue;
    const circle = (scale, dx = 0, dz = 0) => Array.from({ length:20 }, (_, index) => {
      const angle = index / 20 * Math.PI * 2;
      return [x + dx + Math.cos(angle) * radius * scale, ground, z + dz + Math.sin(angle) * radius * scale];
    });
    const inside = circle(.78), middle = circle(1.04, 2, -2), outside = circle(1.42, 6, -6);
    for (let index = 0; index < 20; index++) {
      const next = (index + 1) % 20;
      for (const [point, alpha] of [[[x, ground, z], .56], [inside[index], .56], [inside[next], .56]]) vertex(point, alpha);
      ramp(inside[next], inside[index], middle[index], middle[next], .56, .22);
      ramp(middle[next], middle[index], outside[index], outside[next], .22, 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
