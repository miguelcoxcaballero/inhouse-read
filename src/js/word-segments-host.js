// Marshal a browser iterator once. Selection, counting and carry/flush policy
// use this packed response in Rust. Flags-only responses omit unneeded fields.
export const packSegments = (parts, segmented, coordinates, capacity) => {
  const stride = coordinates ? 3 : 1;
  let packed = new Uint32Array(capacity * stride), at = 0;
  for (const part of parts) {
    if (at + stride > packed.length) {
      const grown = new Uint32Array(Math.max(stride, packed.length * 2));
      grown.set(packed); packed = grown;
    }
    if (coordinates) { packed[at++] = part.index; packed[at++] = (segmented ? part.segment : part[0]).length; }
    packed[at++] = segmented ? Number(Boolean(part.isWordLike)) : 1;
  }
  return packed.subarray(0, at);
};
