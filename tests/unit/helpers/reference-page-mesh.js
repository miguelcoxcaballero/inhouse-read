// Frozen verbatim from book-model.js at e137376068b82bc7051e85754c755b8334b3916d.
// Only exported function names changed; keep independent from the Rust bridge.
import * as THREE from 'three';

export function referencePageBlockGeometry(width, height, thickness, { board = height * .007, inset = height * .009, detail = false } = {}) {
  const half = (thickness - board * 2.4) / 2, top = height / 2 - inset;
  const rim = board * 1.1, back = Math.max(0, thickness * .38 - rim - board * .15), zBack = thickness / 2 - rim;
  const bend = Math.min(thickness * .09, width * .025), fore = width / 2 - inset * .7;
  const columns = detail ? 16 : 8, rows = detail ? 6 : 3, tile = height * .2;
  const spineX = z => -width / 2 - back * Math.sqrt(Math.max(0, 1 - (z / zBack) ** 2));
  const foreX = z => fore - bend * (1 - (z / half) ** 2);
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const vertex = (x, y, z, n, u, v, shade) => {
    positions.push(x, y, z); normals.push(...n); uvs.push(u, v); colors.push(shade, shade, shade);
    return positions.length / 3 - 1;
  };
  const quad = (a, b, c, d) => indices.push(a, b, d, b, c, d);
  const across = i => -half + i / columns * half * 2, leafU = z => (z + half) / tile;
  // Leaves pressed against the boards sit in their shadow.
  const pressed = z => 1 - .18 * Math.abs(z / half) ** 6;
  for (const side of [1, -1]) {
    const start = positions.length / 3;
    for (let i = 0; i <= columns; i++) for (let k = 0; k <= rows; k++) {
      const z = across(i), t = (k / rows) ** 1.7;
      vertex(THREE.MathUtils.lerp(spineX(z), foreX(z), t), side * top, z, [0, side, 0], leafU(z), .98 - .44 * t,
        pressed(z) * (.82 + .18 * Math.min(1, t * 5)));
    }
    for (let i = 0; i < columns; i++) for (let k = 0; k < rows; k++) {
      const a = start + i * (rows + 1) + k, b = a + rows + 1;
      if (side > 0) quad(a, b, b + 1, a + 1); else quad(a, a + 1, b + 1, b);
    }
  }
  const start = positions.length / 3;
  for (let i = 0; i <= columns; i++) {
    const z = across(i), slope = 2 * bend * z / half ** 2, length = Math.hypot(1, slope);
    for (const y of [-top, top]) vertex(foreX(z), y, z, [1 / length, 0, -slope / length], leafU(z), .24 + .22 * y / top, pressed(z));
  }
  for (let i = 0; i < columns; i++) { const a = start + i * 2; quad(a, a + 1, a + 3, a + 2); }
  // Thin skins under the boards close the block when the cover opens.
  for (const side of [1, -1]) {
    const z = side * half, x0 = spineX(z), x1 = foreX(z), n = [0, 0, side];
    const p = [[x0, -top], [x1, -top], [x1, top], [x0, top]].map(([x, y]) => vertex(x, y, z, n, .5, .5, 1));
    if (side > 0) quad(...p); else quad(p[0], p[3], p[2], p[1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.addGroup(0, indices.length, 0);
  return geometry;
}

/** Leaves already read turn over with the front board as one gathering: a
 * block on the board's inner face whose top leaf curls down into the gutter.
 * Hinge coordinates (joint at x = 0, board centred on z = 0); the open face
 * looks toward -z until the board turns over. Only lifted copies build it. */
export function referenceLeafStackGeometry(width, height, depth, { board = height * .007, inset = height * .009, columns = 14 } = {}) {
  // A hair inside the text block, so closed its ends never fight the head,
  // tail or fore-edge they came from.
  const top = height / 2 - inset - height * .0012, fore = width - inset * .7 - height * .0015;
  const base = -board / 2 - height * .0003, tile = height * .2;
  const gutter = Math.min(fore * .2, height * .075), dip = .16;
  // Share of the gathering's depth at x: the leaves bend down into the joint.
  const rise = x => { const t = Math.min(1, x / gutter); return dip + (1 - dip) * t * (2 - t); };
  const riseSlope = x => x < gutter ? (1 - dip) * (2 - 2 * x / gutter) / gutter : 0;
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const vertex = (x, y, z, n, u, v, shade) => {
    positions.push(x, y, z); normals.push(...n); uvs.push(u, v); colors.push(shade, shade, shade);
    return positions.length / 3 - 1;
  };
  // Columns crowd toward the gutter, where the leaves curl.
  const xs = Array.from({ length:columns + 1 }, (_, i) => fore * (i / columns) ** 1.7);
  const faceZ = x => base - depth * rise(x);
  // Open face: the joint's shadow, then clean paper.
  const shade = x => 1 - .34 * Math.max(0, 1 - x / (gutter * 1.7)) ** 2;
  for (const x of xs) {
    const slope = -depth * riseSlope(x), length = Math.hypot(slope, 1);
    for (const y of [-top, top]) vertex(x, y, faceZ(x), [slope / length, 0, -1 / length], x / fore, y / top / 2 + .5, shade(x));
  }
  for (let i = 0; i < columns; i++) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const edge = positions.length / 3;
  // Fore-edge: u runs across the leaves exactly as on the text block.
  for (const y of [-top, top]) for (const k of [0, 1]) {
    vertex(fore, y, k ? faceZ(fore) : base, [1, 0, 0], k * depth * rise(fore) / tile, .24 + .22 * y / top, .94);
  }
  indices.push(edge, edge + 1, edge + 3, edge, edge + 3, edge + 2);
  // Head and tail: every leaf converges into the gutter.
  for (const side of [1, -1]) {
    const start = positions.length / 3;
    for (const x of xs) for (const k of [0, 1]) {
      vertex(x, side * top, k ? faceZ(x) : base, [0, side, 0], k * depth * rise(x) / tile, .98 - .44 * x / fore, .9 * shade(x));
    }
    for (let i = 0; i < columns; i++) {
      const a = start + i * 2, b = a + 1, c = a + 3, d = a + 2;
      if (side > 0) indices.push(a, d, c, a, c, b); else indices.push(a, c, d, a, b, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const faceCount = columns * 6;
  geometry.addGroup(0, faceCount, 0); geometry.addGroup(faceCount, indices.length - faceCount, 1);
  return geometry;
}
