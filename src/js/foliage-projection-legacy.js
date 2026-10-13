import * as THREE from 'three';
export function projectPlantFoliage(model) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const paths = [];
  let triangles = 0;
  const coordinate = point => `${point.x.toFixed(2)},${(-point.y).toFixed(2)}`;
  model.traverse(mesh => {
    if (!mesh.isMesh || !/^(leaf(?:-\d+|-batch)|cactus(?:-column-\d+|-batch))$/.test(mesh.name)) return;
    const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
    const count = indices ? indices.count : positions.count;
    const projected = new Float64Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      a.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      projected[i * 2] = a.x; projected[i * 2 + 1] = a.y;
    }
    for (let i = 0; i < count; i += 3) {
      const ia = (indices ? indices.getX(i) : i) * 2, ib = (indices ? indices.getX(i + 1) : i + 1) * 2,
        ic = (indices ? indices.getX(i + 2) : i + 2) * 2;
      a.set(projected[ia], projected[ia + 1], 0); b.set(projected[ib], projected[ib + 1], 0);
      c.set(projected[ic], projected[ic + 1], 0);
      // All models have a closed lamina/body. Back faces add no visible hit
      // surface and would double both the path size and native hit-test work.
      const facing = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (facing <= .0001) continue;
      paths.push(`M${coordinate(a)}L${coordinate(b)}L${coordinate(c)}Z`); triangles++;
    }
  });
  return { path:paths.join(''), triangles };
}
