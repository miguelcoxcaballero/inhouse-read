import * as THREE from 'three';

// The packet the Rust shelf module returns for a finished model: [u32 header length][JSON header][padding][typed data].
// The header says what each array is and where it lives; the arrays are copied out of it, so nothing the host keeps
// aliases the module's memory.
const TYPES = { f32: Float32Array, i16: Int16Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f64: Float64Array };

/** The header of a packet, a function copying one array out of it and a function viewing one (valid until the
 * packet is dropped; the attribute classes of three copy what they are given). */
export function openPacket(bytes) {
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  const base = bytes.byteOffset + Math.ceil((4 + headerLength) / 4) * 4;
  const copy = (kind, at, length) => new TYPES[kind](bytes.buffer.slice(base + at, base + at + length * TYPES[kind].BYTES_PER_ELEMENT));
  const view = (kind, at, length) => (base + at) % TYPES[kind].BYTES_PER_ELEMENT === 0 ? new TYPES[kind](bytes.buffer, base + at, length) : copy(kind, at, length);
  return { header, copy, view };
}

/** A BufferGeometry as three builds one: Float32 attributes in the packet's order (a generator's own attribute class, or
 * the plain attribute `mergeGeometries` makes when the record's `type` is "BufferGeometry"), the index as
 * `setIndex(array)` makes it (16 or 32 bit), an absent index left absent. The geometry takes the record's `type`. */
export function geometryOf(packet, { type, attributes, index, groups = [] }) {
  const geometry = new THREE.BufferGeometry();
  const merged = !type || type === 'BufferGeometry';
  if (type) geometry.type = type;
  for (const [name, size, , at, length] of attributes) {
    geometry.setAttribute(name, merged ? new THREE.BufferAttribute(packet.copy('f32', at, length), size)
      : new THREE.Float32BufferAttribute(packet.view('f32', at, length), size));
  }
  if (index) geometry.setIndex(new (index[0] === 'u32' ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute)(packet.view(index[0], index[1], index[2]), 1));
  for (const [start, count, materialIndex] of groups) geometry.addGroup(start, count, materialIndex);
  return geometry;
}

/** The scene graph of a prop packet (rust-ui/src/shelf_models.rs): a Mesh per node with geometry (its material is
 * `materials[role]`), a Group per node without, each added to its parent (or `root`) in packet order with its
 * position and, where the packet has them, its rotation and scale. Returns the objects in packet order. */
export function buildNodes(packet, materials, root) {
  const transforms = packet.copy(...packet.header.transforms);
  return packet.header.nodes.reduce((objects, node, index) => {
    const object = node.attributes ? new THREE.Mesh(geometryOf(packet, node), materials[node.material]) : new THREE.Group();
    const at = index * 9;
    object.name = node.name;
    object.position.set(transforms[at], transforms[at + 1], transforms[at + 2]);
    if (node.rotation) object.rotation.set(transforms[at + 3], transforms[at + 4], transforms[at + 5], node.rotation);
    if (node.scaled) object.scale.set(transforms[at + 6], transforms[at + 7], transforms[at + 8]);
    (node.parent < 0 ? root : objects[node.parent]).add(object);
    objects.push(object);
    return objects;
  }, []);
}
