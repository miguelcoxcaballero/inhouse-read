import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';
import { BAGGEBO_SPEC } from './shelf-types.js';

// The cabinet's geometry (posts, feet, folded pans and lips, mount tabs, screws, the expanded-metal sheets
// and the rear brace, merged by material) is drawn by the Rust shelf module once, as one packet; this file
// builds three's objects from it. Materials and the powder-coat texture are three.js objects.
let modelTemplate;
const TYPES = { f32: Float32Array, i16: Int16Array, u8: Uint8Array };

/** The packet: [u32 header length][JSON header][padding][typed data]. Arrays are copied out of it. */
function unpackTemplate() {
  const bytes = needRustShelf().baggebo_template();
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  const base = bytes.byteOffset + Math.ceil((4 + headerLength) / 4) * 4;
  const copy = (Type, at, length) => new Type(bytes.buffer.slice(base + at, base + at + length * Type.BYTES_PER_ELEMENT));
  const batches = header.batches.map(({ material, attributes, index }) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, size, kind, at, length] of attributes) {
      geometry.setAttribute(name, new THREE.BufferAttribute(copy(TYPES[kind], at, length), size, kind !== 'f32'));
    }
    geometry.setIndex(new THREE.BufferAttribute(copy(index[0] === 'u32' ? Uint32Array : Uint16Array, index[1], index[2]), 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const template = { materialIndex:material, attributes:geometry.attributes, index:geometry.index.array,
      boundingBox:geometry.boundingBox, boundingSphere:geometry.boundingSphere };
    geometry.dispose();
    return template;
  });
  const parts = header.parts.map(({ name, box, ...metadata }) => ({ name,
    bounds:new THREE.Box3(new THREE.Vector3(box[0], box[1], box[2]), new THREE.Vector3(box[3], box[4], box[5])), ...metadata }));
  return { batches, parts };
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

function createPaintTexture() {
  const size = 32;
  const texture = new THREE.DataTexture(needRustShelf().baggebo_paint_texture(), size, size, THREE.RGBAFormat);
  texture.name = 'BAGGEBO fine powder coat';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

/** BAGGEBO 504.811.72. Coordinates are millimetres at width=600: x centred,
 * top y=0, feet y=-1160, front z=0 and back z=-250. Uniform scaling preserves
 * the real proportions; the original has three internal shelves and a mesh top. */
export function createBaggebo({ width = 600 } = {}) {
  const actualWidth = Number.isFinite(width) && width > 0 ? width : 600;
  const scale = actualWidth / BAGGEBO_SPEC.dimensions.width;
  const { height, depth } = BAGGEBO_SPEC.dimensions;
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
  const geometries = [], materials = [paint, meshPaint, hardware, footMaterial];

  // Cache the entire finished furniture as immutable CPU data, not live GPU
  // objects. Reopening a preview or adding another unit only copies buffers.
  modelTemplate ??= unpackTemplate();
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
