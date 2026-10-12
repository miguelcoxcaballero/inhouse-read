import * as THREE from 'three';
export function compactGeometry(source) {
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

