// Frozen original dbd6205 curved binding implementation, before this Rust port.
import * as THREE from 'three';
export function referenceBindingGeometry(width, height, thickness, segments = 96, relief = null, reliefRows = 384) {
  const positions = [], normals = [], uv = [], indices = [];
  const bulge = thickness * 0.38;
  const rows = relief ? reliefRows : 1;
  for (let i = 0; i <= segments; i++) {
    const a = i / segments * Math.PI;
    const nx = -Math.sin(a) / bulge, nz = -Math.cos(a) / (thickness / 2);
    const length = Math.hypot(nx, nz);
    for (let j = 0; j <= rows; j++) {
      const u = i / segments, v = j / rows;
      const depth = relief ? relief(u, v) * height * .0007 : 0;
      positions.push(-width / 2 - bulge * Math.sin(a) - nx / length * depth,
        (v - .5) * height, -thickness / 2 * Math.cos(a) - nz / length * depth);
      normals.push(nx / length, 0, nz / length); uv.push(u, v);
      if (i < segments && j < rows) {
        const k = i * (rows + 1) + j;
        indices.push(k, k + rows + 1, k + 1, k + 1, k + rows + 1, k + rows + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  if (relief) g.computeVertexNormals();
  return g;
}


