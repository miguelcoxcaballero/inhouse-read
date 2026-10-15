// Reads the packet the Rust shelf module returns for a geometry:
// [u32 header length][JSON header][padding to 4][typed data], the header listing each attribute as
// [name, itemSize, type, byteOffset, length] and the index as [type, byteOffset, length].
const TYPES = { f32: Float32Array, i16: Int16Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };

export function readPacket(bytes) {
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)));
  const base = bytes.byteOffset + Math.ceil((4 + headerLength) / 4) * 4;
  const copy = (kind, at, length) => new TYPES[kind](bytes.buffer.slice(base + at, base + at + length * TYPES[kind].BYTES_PER_ELEMENT));
  return { header, copy };
}

/** One geometry's attributes and index as typed arrays (the index is null when empty). */
export function readGeometry(bytes, header = null, copy = null) {
  const packet = header ? { header, copy } : readPacket(bytes);
  const attributes = {};
  for (const [name, size, kind, at, length] of packet.header.attributes) attributes[name] = { itemSize: size, array: packet.copy(kind, at, length), kind };
  const [kind, at, length] = packet.header.index;
  return { attributes, index: length ? packet.copy(kind, at, length) : null };
}
