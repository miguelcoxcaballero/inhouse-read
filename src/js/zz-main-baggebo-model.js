import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';
import { BAGGEBO_SPEC } from './shelf-types.js';
import { makeMaterials, openPacket } from './zz-main-geo-packet.js';

// The cabinet's geometry (posts, feet, folded pans and lips, mount tabs, screws, the expanded-metal sheets
// and the rear brace, merged by material) is drawn by the Rust shelf module once, as one packet; this file
// builds three's objects from it. Materials and the powder-coat texture are three.js objects.
let modelTemplate;

/** The packet (see geo-packet.js); arrays are copied out of it. */
function unpackTemplate() {
  const { header, copy } = openPacket(needRustShelf().baggebo_template());
  const batches = header.batches.map(({ material, attributes, index }) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, size, kind, at, length] of attributes) {
      geometry.setAttribute(name, new THREE.BufferAttribute(copy(kind, at, length), size, kind !== 'f32'));
    }
    geometry.setIndex(new THREE.BufferAttribute(copy(index[0] === 'u32' ? 'u32' : 'u16', index[1], index[2]), 1));
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
 * the real proportions; the original has three internal shelves and a mesh top.
 * The fit, the shelf positions and the material table come from Rust (shelf_lib.rs). */
export function createBaggebo({ width = 600 } = {}) {
  const shelf = needRustShelf(), layout = shelf.baggebo_layout(width, BAGGEBO_SPEC);
  const group = new THREE.Group();
  group.name = 'IKEA BAGGEBO white powder-coated steel';
  group.scale.setScalar(layout.scale);
  group.userData.furniture = true;
  group.userData.shelfType = 'baggebo';
  group.userData.physicalDimensions = layout.physicalDimensions;
  group.userData.specification = BAGGEBO_SPEC;
  group.userData.shelfPositions = layout.shelfPositions;
  group.userData.parts = [];

  const paintTexture = createPaintTexture();
  const { paint, meshPaint, hardware, foot:footMaterial } = makeMaterials(JSON.parse(shelf.baggebo_materials()), { paint:paintTexture });
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
