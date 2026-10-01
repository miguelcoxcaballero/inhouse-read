import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BAGGEBO_SPEC } from './shelf-types.js';

const PERIOD_X = BAGGEBO_SPEC.meshPitch.width * 2;
const PERIOD_Y = BAGGEBO_SPEC.meshPitch.height;
const STRAND_WIDTH = .9;
const SHEET_THICKNESS = .65;
const panelTemplates = new Map();
let modelTemplate;

/** Index only vertices whose complete attributes match. The ridge's different
 * normals stay separate, so this changes storage and vertex work, not facets,
 * apertures, UVs or triangle coverage. No global vertex hashes are needed. */
function compactGeometry(source) {
  const attributes = Object.entries(source.attributes);
  const words = attributes.map(([name, attribute]) => {
    if (name === 'normal' || name === 'color') {
      const factor = name === 'normal' ? 32767 : 255;
      return Uint32Array.from(attribute.array, value => Math.round(value * factor));
    }
    return new Uint32Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.length);
  });
  const count = source.getAttribute('position').count;
  const original = new Uint32Array(count), index = new Uint32Array(count);
  let unique = 0, firstInPair = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    // Every pressed facet is emitted as two adjacent triangles. Comparing
    // their six corners avoids hashing the entire expanded sheet at startup.
    if (vertex % 6 === 0) firstInPair = unique;
    let match = firstInPair;
    for (; match < unique; match += 1) {
      let equal = true;
      for (let attribute = 0; equal && attribute < attributes.length; attribute += 1) {
        const size = attributes[attribute][1].itemSize;
        for (let component = 0; component < size; component += 1) {
          if (words[attribute][vertex * size + component] !== words[attribute][original[match] * size + component]) {
            equal = false; break;
          }
        }
      }
      if (equal) break;
    }
    if (match === unique) original[unique++] = vertex;
    index[vertex] = match;
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of attributes) {
    // Signed normalized 16-bit normals have < 0.000016 component error;
    // positions and physical paint UVs retain their original Float32 values.
    const normalized = name === 'normal' || name === 'color';
    const ArrayType = name === 'normal' ? Int16Array : name === 'color' ? Uint8Array : Float32Array;
    const array = new ArrayType(unique * attribute.itemSize);
    const factor = name === 'normal' ? 32767 : name === 'color' ? 255 : 1;
    for (let vertex = 0; vertex < unique; vertex += 1) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const value = attribute.array[original[vertex] * attribute.itemSize + component];
        array[vertex * attribute.itemSize + component] = normalized ? Math.round(value * factor) : value;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(unique > 65535 ? index : new Uint16Array(index), 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function cloneTemplateGeometry(template) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(template.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(), attribute.itemSize, attribute.normalized));
  }
  geometry.setIndex(new THREE.BufferAttribute(template.index.slice(), 1));
  geometry.boundingBox = template.boundingBox.clone();
  geometry.boundingSphere = template.boundingSphere.clone();
  return geometry;
}

/** Actual expanded sheet. Adjacent hexagons share each strand; two shallow
 * facets give it a pressed ridge and visible thickness without opaque planes
 * across the apertures. A single batched mesh keeps all four shelves cheap. */
function expandedMetal(uMin, uMax, vMin, vMax, toPosition) {
  const pitch = BAGGEBO_SPEC.meshPitch.width, halfHeight = PERIOD_Y / 2;
  const outer = pitch * .6, shoulder = pitch * .4;
  const corners = [[-outer, 0], [-shoulder, -halfHeight], [shoulder, -halfHeight],
    [outer, 0], [shoulder, halfHeight], [-shoulder, halfHeight]];
  const segments = new Map();
  const key = (u, v) => `${Math.round(u * 1000)},${Math.round(v * 1000)}`;
  const addSegment = (au, av, bu, bv) => {
    const a = key(au, av), b = key(bu, bv);
    segments.set(a < b ? `${a}:${b}` : `${b}:${a}`, [au, av, bu, bv]);
  };
  for (let row = Math.floor(vMin / PERIOD_Y) - 1; row <= Math.ceil(vMax / PERIOD_Y) + 1; row += 1) {
    for (let column = Math.floor(uMin / PERIOD_X) - 1; column <= Math.ceil(uMax / PERIOD_X) + 1; column += 1) {
      for (const [offsetU, offsetV] of [[0, 0], [pitch, halfHeight]]) {
        const u = column * PERIOD_X + offsetU, v = row * PERIOD_Y + offsetV;
        for (let edge = 0; edge < corners.length; edge += 1) {
          const a = corners[edge], b = corners[(edge + 1) % corners.length];
          addSegment(u + a[0], v + a[1], u + b[0], v + b[1]);
        }
      }
    }
  }
  // The cut edge sits inside the folded perimeter. Finishing it here also
  // makes the nominal sheet size independent of where an aperture is cut.
  addSegment(uMin, vMin, uMax, vMin); addSegment(uMax, vMin, uMax, vMax);
  addSegment(uMax, vMax, uMin, vMax); addSegment(uMin, vMax, uMin, vMin);

  const positions = [], uvs = [];
  const point = (u, v, normal) => [Math.max(uMin, Math.min(uMax, u)), Math.max(vMin, Math.min(vMax, v)), normal];
  const triangle = (a, b, c) => {
    for (const vertex of [a, b, c]) {
      positions.push(...toPosition(...vertex));
      uvs.push(vertex[0] / 8, vertex[1] / 8);
    }
  };
  for (const [au, av, bu, bv] of segments.values()) {
    const du = bu - au, dv = bv - av;
    // Liang–Barsky clips strands at the cut sheet boundary, without stretched
    // triangles or the repeating alpha texture's fuzzy edges at close zoom.
    let from = 0, to = 1;
    let clipped = false;
    for (const [direction, distance] of [[-du, au - uMin], [du, uMax - au], [-dv, av - vMin], [dv, vMax - av]]) {
      if (Math.abs(direction) < 1e-9) { if (distance < 0) { clipped = true; break; } continue; }
      const ratio = distance / direction;
      if (direction < 0) from = Math.max(from, ratio); else to = Math.min(to, ratio);
      if (from >= to) { clipped = true; break; }
    }
    if (clipped) continue;
    const length = Math.hypot(du, dv), nu = -dv / length * STRAND_WIDTH / 2, nv = du / length * STRAND_WIDTH / 2;
    const u0 = au + du * from, v0 = av + dv * from, u1 = au + du * to, v1 = av + dv * to;
    const leftA = point(u0 + nu, v0 + nv, -SHEET_THICKNESS), ridgeA = point(u0, v0, 0), rightA = point(u0 - nu, v0 - nv, -SHEET_THICKNESS);
    const leftB = point(u1 + nu, v1 + nv, -SHEET_THICKNESS), ridgeB = point(u1, v1, 0), rightB = point(u1 - nu, v1 - nv, -SHEET_THICKNESS);
    if (Math.abs(dv) < 1e-7) {
      // The short connecting bonds are flattened by the expanding process;
      // one inclined face is enough here, while the stretched strands have
      // two facets. This saves a third of the bond vertices on mobile.
      leftA[2] = leftB[2] = 0;
      triangle(leftA, rightA, rightB); triangle(leftA, rightB, leftB);
    } else {
      triangle(leftA, ridgeA, ridgeB); triangle(leftA, ridgeB, leftB);
      triangle(ridgeA, rightA, rightB); triangle(ridgeA, rightB, ridgeB);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
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

function panelGeometry(key, create) {
  if (!panelTemplates.has(key)) {
    const source = create(), geometry = compactGeometry(source);
    source.dispose();
    panelTemplates.set(key, { attributes:geometry.attributes, index:geometry.index.array,
      boundingBox:geometry.boundingBox, boundingSphere:geometry.boundingSphere });
    geometry.dispose();
  }
  return cloneTemplateGeometry(panelTemplates.get(key));
}

function horizontalMesh(width, depth, y, front) {
  return panelGeometry(`shelf:${width}:${depth}:${front}`, () => expandedMetal(-width / 2, width / 2, -front, depth - front,
    (u, v, normal) => [u, normal, -v])).translate(0, y, 0);
}

function rearMesh(width, height, top, z) {
  // The brace is cut from the same expanded sheet, turned a quarter turn.
  return panelGeometry(`brace:${width}:${height}:${top}:${z}`, () => expandedMetal(top, top + height, -width / 2, width / 2,
    (u, v, normal) => [v, -u, z + normal]));
}

/** Powder-coat grain stays sub-millimetre on both short rails and long posts. */
function physicalPaintUVs(geometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const nx = Math.abs(normals.getX(index)), ny = Math.abs(normals.getY(index)), nz = Math.abs(normals.getZ(index));
    if (nx >= ny && nx >= nz) uv.setXY(index, z / 8, y / 8);
    else if (ny >= nz) uv.setXY(index, x / 8, z / 8);
    else uv.setXY(index, x / 8, y / 8);
  }
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

  const paintTexture = createPaintTexture();
  const paint = new THREE.MeshPhysicalMaterial({ color:0xf7f8f6, roughness:.36, metalness:.08,
    bumpMap:paintTexture, bumpScale:.024, clearcoat:.16, clearcoatRoughness:.4 });
  paint.name = 'Warm white epoxy polyester powder-coated steel';
  const meshPaint = new THREE.MeshStandardMaterial({ color:0xf7f8f6, roughness:.38, metalness:.08,
    bumpMap:paintTexture, bumpScale:.018, side:THREE.DoubleSide });
  meshPaint.name = 'Open expanded white-painted steel';
  const hardware = new THREE.MeshStandardMaterial({ color:0xd1d2cd, roughness:.32, metalness:.5, vertexColors:true });
  hardware.name = 'Zinc plated recessed fixing heads';
  const footMaterial = new THREE.MeshStandardMaterial({ color:0xe8e8df, roughness:.76, metalness:0 });
  footMaterial.name = 'Polypropylene adjustable feet';
  const batches = new Map(), geometries = [], materials = [paint, meshPaint, hardware, footMaterial];

  if (!modelTemplate) {
    const add = (geometry, material, name, metadata = {}) => {
      if (material === hardware) {
        const shade = name.includes('-slot-') ? .24 : 1;
        const colors = new Float32Array(geometry.getAttribute('position').count * 3).fill(shade);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      if (material === paint) {
        const positions = geometry.getAttribute('position');
        // Rounded folded edges can exceed the nominal top by Float32 roundoff.
        // Keep the shared book baseline and the published footprint exact.
        for (let index = 0; index < positions.count; index += 1) {
          const y = positions.getY(index);
          if (y > 0 && y < 1e-6) positions.setY(index, 0);
        }
        physicalPaintUVs(geometry);
      }
      geometry.computeBoundingBox();
      group.userData.parts.push({ name, bounds:geometry.boundingBox.clone(), ...metadata });
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material).push(geometry);
    };
    const box = (name, w, h, d, x, y, z, material = paint, radius = .65, metadata, segments = 1) => {
      const geometry = name.includes('-slot-')
        ? new THREE.BoxGeometry(w, h, d).toNonIndexed()
        : new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, w / 3, h / 3, d / 3));
      geometry.translate(x, y, z);
      add(geometry, material, name, metadata);
    };
    const screw = (name, x, y, z, axis = 'z', radius = 2.55) => {
      const geometry = new THREE.CylinderGeometry(radius * .88, radius, 1.1, 20).toNonIndexed();
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
        x, -(height - 7) / 2, z, paint, .85, { kind:'upright' }, 2);
      const foot = new THREE.CylinderGeometry(post / 2 - .35, post / 2, 4.8, 24).toNonIndexed();
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
      // Rolled sheet edges catch a narrow highlight and hide the raw cut ends.
      box(`${name}-front-folded-lip`, 600 - post * 2, .8, 3.2, 0, y - .4, surfaceFront - 1.6, paint, .25, { kind:'folded-lip' });
      box(`${name}-back-folded-lip`, 600 - post * 2, .8, 3.2, 0, y - .4, -235 + 1.6, paint, .25, { kind:'folded-lip' });
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
        { kind:index === 0 ? 'mesh-top' : 'mesh-shelf', baseline:y, thickness:SHEET_THICKNESS, apertureGeometry:true });
    }

    const brace = BAGGEBO_SPEC.rearBrace, braceZ = -249;
    add(rearMesh(brace.width, brace.height, brace.top, braceZ), meshPaint, 'rear-central-mesh-brace', { kind:'mesh-brace', thickness:SHEET_THICKNESS, apertureGeometry:true });
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

    const batchTemplates = [];
    for (const [material, sources] of batches) {
      const merged = mergeGeometries(sources, false);
      for (const source of sources) source.dispose();
      // Sheet templates are already indexed; the other assembly batches still
      // need their repeated rounded-box and fixing vertices compacted once.
      const geometry = merged.index ? merged : compactGeometry(merged);
      if (geometry !== merged) merged.dispose();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      batchTemplates.push({ materialIndex:materials.indexOf(material), attributes:geometry.attributes,
        index:geometry.index.array, boundingBox:geometry.boundingBox, boundingSphere:geometry.boundingSphere });
      geometry.dispose();
    }
    modelTemplate = { batches:batchTemplates, parts:group.userData.parts };
    panelTemplates.clear();
  }

  // Cache the entire finished furniture as immutable CPU data, not live GPU
  // objects. Reopening a preview or adding another unit only copies buffers.
  group.userData.parts = modelTemplate.parts.map(part => ({ ...part, bounds:part.bounds.clone() }));
  for (const template of modelTemplate.batches) {
    const geometry = cloneTemplateGeometry(template), material = materials[template.materialIndex];
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    paintTexture.dispose();
  };
  group.userData.dispose = dispose;
  group.userData.disposeGeometry = dispose;
  return group;
}
