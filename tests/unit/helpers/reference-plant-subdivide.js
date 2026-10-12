import * as THREE from 'three';
export function subdivideSurface(surface) {
  // Add shared interior vertices before bending: silhouette-only triangulation
  // otherwise leaves large flat facets across the broad Monstera blade.
  const positions = [...surface.attributes.position.array], indices = [], midpoints = new Map();
  const midpoint = (a,b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!midpoints.has(key)) {
      midpoints.set(key,positions.length/3);
      for (let axis = 0; axis < 3; axis++) positions.push((positions[a*3+axis]+positions[b*3+axis])/2);
    }
    return midpoints.get(key);
  };
  const source = surface.index.array;
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i], b = source[i+1], c = source[i+2];
    const ab = midpoint(a,b), bc = midpoint(b,c), ca = midpoint(c,a);
    indices.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
  }
  surface.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  surface.setIndex(indices); return surface;
}
