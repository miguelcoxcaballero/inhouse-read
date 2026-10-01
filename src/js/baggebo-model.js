import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BAGGEBO_SPEC } from './shelf-types.js';

const PERIOD_X = BAGGEBO_SPEC.meshPitch.width * 2;
const PERIOD_Y = BAGGEBO_SPEC.meshPitch.height;
const MASK_WIDTH = 128, MASK_HEIGHT = 64;
let meshMaskPixels;
const positiveModulo = (value, period) => ((value % period) + period) % period;

function distanceToSegmentSquared(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  const px = x - ax - t * dx, py = y - ay - t * dy;
  return px * px + py * py;
}

/** Expanded metal has elongated hexagonal apertures, not a printed grid.
 * One small repeating mask serves the four shelves and rear brace. */
function strandDistance(x, y) {
  const pitch = BAGGEBO_SPEC.meshPitch.width;
  const halfHeight = PERIOD_Y / 2;
  const outer = pitch * .6, shoulder = pitch * .4;
  const vertices = [[-outer, 0], [-shoulder, -halfHeight], [shoulder, -halfHeight],
    [outer, 0], [shoulder, halfHeight], [-shoulder, halfHeight]];
  let distance = Infinity;
  for (const [cx, cy] of [[0, 0], [0, PERIOD_Y], [PERIOD_X, 0], [PERIOD_X, PERIOD_Y], [pitch, halfHeight]]) {
    const px = x - cx, py = y - cy;
    for (let index = 0; index < vertices.length; index += 1) {
      const [ax, ay] = vertices[index], [bx, by] = vertices[(index + 1) % vertices.length];
      distance = Math.min(distance, distanceToSegmentSquared(px, py, ax, ay, bx, by));
    }
  }
  return Math.sqrt(distance);
}

function createMeshMask() {
  const data = meshMaskPixels || new Uint8Array(MASK_WIDTH * MASK_HEIGHT * 4);
  if (!meshMaskPixels) for (let y = 0; y < MASK_HEIGHT; y += 1) for (let x = 0; x < MASK_WIDTH; x += 1) {
    const distance = strandDistance((x + .5) / MASK_WIDTH * PERIOD_X, (y + .5) / MASK_HEIGHT * PERIOD_Y);
    const coverage = Math.round(255 * Math.max(0, Math.min(1, (.45 - distance) / .13)));
    const index = (y * MASK_WIDTH + x) * 4;
    // Three's alphaMap uses green, for the colour and both shadow passes.
    data[index] = data[index + 1] = data[index + 2] = coverage; data[index + 3] = 255;
  }
  // The pixels are immutable; each model still owns its disposable GPU texture.
  meshMaskPixels = data;
  const texture = new THREE.DataTexture(data, MASK_WIDTH, MASK_HEIGHT, THREE.RGBAFormat);
  texture.name = 'BAGGEBO elongated hexagonal metal apertures';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function createPaintTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const grain = 122 + ((Math.imul(index + 31, 1664525) ^ Math.imul(index + 17, 1013904223)) >>> 0) % 14;
    data[index * 4] = data[index * 4 + 1] = data[index * 4 + 2] = grain; data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'BAGGEBO fine powder coat';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

/** Raycaster does not sample alphaMap itself. Filter its plane intersections
 * against the same aperture mask, so an empty mesh hole is truly empty. */
function apertureRaycast(mesh, mask) {
  const original = mesh.raycast;
  mesh.raycast = function raycastWithApertures(raycaster, intersections) {
    const candidates = [];
    original.call(this, raycaster, candidates);
    const { data, width, height } = mask.image;
    for (const hit of candidates) {
      if (!hit.uv) continue;
      const x = Math.min(width - 1, Math.floor(positiveModulo(hit.uv.x, 1) * width));
      const y = Math.min(height - 1, Math.floor(positiveModulo(hit.uv.y, 1) * height));
      if (data[(y * width + x) * 4 + 1] / 255 >= this.material.alphaTest) intersections.push(hit);
    }
  };
}

function horizontalMesh(width, depth, y, front) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, front - depth / 2);
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let index = 0; index < positions.count; index += 1) {
    uv.setXY(index, positions.getX(index) / PERIOD_X, -positions.getZ(index) / PERIOD_Y);
  }
  return geometry.toNonIndexed();
}

function rearMesh(width, height, top, z) {
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, -top - height / 2, z);
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let index = 0; index < positions.count; index += 1) {
    // The brace is cut from the same expanded sheet, turned a quarter turn.
    uv.setXY(index, -positions.getY(index) / PERIOD_X, positions.getX(index) / PERIOD_Y);
  }
  return geometry.toNonIndexed();
}

/** BAGGEBO 504.811.72. Coordinates are millimetres at width=600: x centred,
 * top y=0, feet y=-1160, front z=0 and back z=-250. Uniform scaling preserves
 * the real proportions; the original has three internal shelves and a mesh top. */
export function createBaggebo({ width = 600 } = {}) {
  const actualWidth = Number.isFinite(width) && width > 0 ? width : 600;
  const scale = actualWidth / BAGGEBO_SPEC.dimensions.width;
  const { height, depth } = BAGGEBO_SPEC.dimensions;
  const post = BAGGEBO_SPEC.postSize, rim = BAGGEBO_SPEC.shelfRimHeight;
  const group = new THREE.Group();
  group.name = 'IKEA BAGGEBO white powder-coated steel';
  group.scale.setScalar(scale);
  group.userData.furniture = true;
  group.userData.shelfType = 'baggebo';
  group.userData.physicalDimensions = { width:actualWidth, depth:depth * scale, height:height * scale };
  group.userData.specification = BAGGEBO_SPEC;
  group.userData.shelfPositions = BAGGEBO_SPEC.shelfBottoms.map(bottom => ({ bottom:bottom * scale, y:-bottom * scale, fromFloor:(height - bottom) * scale }));
  group.userData.parts = [];

  const mask = createMeshMask(), paintTexture = createPaintTexture();
  const paint = new THREE.MeshStandardMaterial({ color:0xf5f4ee, roughness:.42, metalness:.08,
    bumpMap:paintTexture, bumpScale:.06 });
  paint.name = 'Warm white epoxy polyester powder-coated steel';
  const meshPaint = new THREE.MeshStandardMaterial({ color:0xf5f4ee, roughness:.44, metalness:.08,
    alphaMap:mask, alphaTest:.35, alphaToCoverage:true, side:THREE.DoubleSide });
  meshPaint.name = 'Open expanded white-painted steel';
  const hardware = new THREE.MeshStandardMaterial({ color:0xd1d2cd, roughness:.32, metalness:.5, vertexColors:true });
  hardware.name = 'Zinc plated recessed fixing heads';
  const footMaterial = new THREE.MeshStandardMaterial({ color:0xe8e8df, roughness:.76, metalness:0 });
  footMaterial.name = 'Polypropylene adjustable feet';
  const batches = new Map(), geometries = [], materials = [paint, meshPaint, hardware, footMaterial];
  const shadows = [];

  const add = (geometry, material, name, metadata = {}) => {
    if (material === hardware) {
      const shade = name.includes('-slot-') ? .24 : 1;
      const colors = new Float32Array(geometry.getAttribute('position').count * 3).fill(shade);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geometry.computeBoundingBox();
    group.userData.parts.push({ name, bounds:geometry.boundingBox.clone(), ...metadata });
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  };
  const box = (name, w, h, d, x, y, z, material = paint, radius = .65, metadata) => {
    const geometry = new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 3, h / 3, d / 3));
    geometry.translate(x, y, z);
    add(geometry, material, name, metadata);
  };
  const screw = (name, x, y, z, axis = 'z', radius = 2.55) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, 1.1, 8).toNonIndexed();
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
    else if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    geometry.translate(x, y, z);
    add(geometry, hardware, name, { kind:'screw' });
    // Tiny dark cross grooves remain within the fixing head's footprint.
    if (axis === 'z') {
      box(`${name}-slot-horizontal`, 3.05, .5, .08, x, y, z + .555, hardware, .02);
      box(`${name}-slot-vertical`, .5, 3.05, .08, x, y, z + .555, hardware, .02);
    }
  };

  // Four continuous slender uprights and the manual's small adjustable feet.
  for (const side of [-1, 1]) for (const [label, z] of [['front', -post / 2], ['back', -depth + post / 2]]) {
    const x = side * (600 - post) / 2;
    box(`${side < 0 ? 'left' : 'right'}-${label}-upright`, post, height - 7, post,
      x, -(height - 7) / 2, z, paint, .85, { kind:'upright' });
    const foot = new THREE.CylinderGeometry(post / 2, post / 2, 4.8, 12).toNonIndexed();
    foot.translate(x, -height + 2.4, z);
    add(foot, footMaterial, `${side < 0 ? 'left' : 'right'}-${label}-foot`, { kind:'foot' });
    const stem = new THREE.CylinderGeometry(2.8, 2.8, 2.2, 8).toNonIndexed();
    stem.translate(x, -height + 5.9, z);
    add(stem, hardware, `${side < 0 ? 'left' : 'right'}-${label}-adjustment-stem`, { kind:'foot-stem' });
  }

  const surfaceWidth = 567.5, surfaceFront = -15;
  for (const [index, bottom] of [0, ...BAGGEBO_SPEC.shelfBottoms].entries()) {
    const name = index === 0 ? 'top' : `shelf-${index - 1}`;
    const y = -bottom;
    // Folded steel rims are beneath the mesh baseline, leaving books seated
    // at exactly the source model's surface elevations.
    box(`${name}-front-rim`, 600 - post * 2, rim, 2.1, 0, y - rim / 2, surfaceFront - 1.05);
    box(`${name}-back-rim`, 600 - post * 2, rim, 2.1, 0, y - rim / 2, -235 + 1.05);
    for (const side of [-1, 1]) {
      box(`${name}-${side < 0 ? 'left' : 'right'}-rim`, 2.1, rim, 220,
        side * (surfaceWidth / 2 - 1.05), y - rim / 2, -depth / 2);
      box(`${name}-${side < 0 ? 'left' : 'right'}-mount-tab`, 9, 18, 1.2,
        side * 275, y - 22, -235 + .6, paint, .25);
      screw(`${name}-${side < 0 ? 'left' : 'right'}-front-fixing`, side * 278, y - 9, surfaceFront + .6);
      screw(`${name}-${side < 0 ? 'left' : 'right'}-back-fixing`, side * 278, y - 9, -233.3);
    }
    // A genuine central reinforcing strip under each expanded-metal panel.
    box(`${name}-underside-stiffener`, 3.5, 3, 216, 0, y - 2.25, -depth / 2, paint, .3);
    add(horizontalMesh(surfaceWidth, 220, y, surfaceFront), meshPaint, `${name}-mesh`,
      { kind:index === 0 ? 'mesh-top' : 'mesh-shelf', baseline:y, thickness:.12 });
  }

  const brace = BAGGEBO_SPEC.rearBrace, braceZ = -249;
  add(rearMesh(brace.width, brace.height, brace.top, braceZ), meshPaint, 'rear-central-mesh-brace', { kind:'mesh-brace' });
  for (const side of [-1, 1]) {
    box(`rear-brace-${side < 0 ? 'left' : 'right'}-fold`, 2.2, brace.height, 2,
      side * (brace.width / 2 - 1.1), -(brace.top + brace.height / 2), braceZ, paint, .3);
    for (const top of [brace.top + 6, brace.bottom - 6]) screw(`rear-brace-${side}-${top}-fixing`, side * 94, -top, -247.3);
  }
  for (const top of [brace.top + 1, brace.bottom - 1]) {
    box(`rear-brace-${top}-edge`, brace.width, 2, 2, 0, -top, braceZ, paint, .3);
  }
  // Pair of small wall attachment tabs shown under the top rear rail.
  for (const side of [-1, 1]) {
    box(`wall-tab-${side}`, 10, 20, 1.2, side * 90, -27, -248.9, paint, .35);
    screw(`wall-tab-${side}-fixing`, side * 90, -33, -247.8, 'z', 1.8);
  }

  for (const [material, sources] of batches) {
    const geometry = mergeGeometries(sources, false);
    for (const source of sources) source.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (material === meshPaint) {
      apertureRaycast(mesh, mask);
      const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking:THREE.RGBADepthPacking,
        alphaMap:mask, alphaTest:meshPaint.alphaTest, side:THREE.DoubleSide });
      const distanceMaterial = new THREE.MeshDistanceMaterial({ alphaMap:mask,
        alphaTest:meshPaint.alphaTest, side:THREE.DoubleSide });
      mesh.customDepthMaterial = depthMaterial; mesh.customDistanceMaterial = distanceMaterial;
      shadows.push(depthMaterial, distanceMaterial);
    }
    group.add(mesh);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of [...materials, ...shadows]) material.dispose();
    mask.dispose(); paintTexture.dispose();
  };
  group.userData.dispose = dispose;
  group.userData.disposeGeometry = dispose;
  return group;
}
