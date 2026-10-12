import * as THREE from 'three';
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

export function textureOffset(seed) {
  const value = hash(seed);
  return [((value >>> 8) % 1009) / 109, ((value >>> 18) % 1013) / 113];
}

/** Every board is cut from a slightly different flitch: a small, deterministic
 * shift in value and warmth, carried by vertex colours (no extra draw call). */
export function boardTone(seed) {
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
export function chamferedTimber(width, height, depth, bevel, grainAxis, seed, tone) {
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
export function shelfLip(width, seed) {
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

