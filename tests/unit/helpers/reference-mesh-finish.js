import * as THREE from 'three';
export function physicalPaintUVs(geometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    const nx = Math.abs(normals.getX(index)), ny = Math.abs(normals.getY(index)), nz = Math.abs(normals.getZ(index));
    if (nx >= ny && nx >= nz) uv.setXY(index, z / 8, y / 8);
    else if (ny >= nz) uv.setXY(index, x / 8, z / 8);
    else uv.setXY(index, x / 8, y / 8);
  }
}

export function smoothPostNormals(geometry){
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const sums = new Map();
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(normals.getY(index)) > .5) continue;
    const key = `${positions.getX(index)}:${positions.getZ(index)}`;
    const sum = sums.get(key) ?? new THREE.Vector3();
    sum.add(new THREE.Vector3(normals.getX(index), 0, normals.getZ(index)));
    sums.set(key, sum);
  }
  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(normals.getY(index)) > .5) continue;
    const sum = sums.get(`${positions.getX(index)}:${positions.getZ(index)}`).clone().normalize();
    normals.setXYZ(index, sum.x, 0, sum.z);
  }
}
