import * as THREE from 'three';

const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(value) || 0));
const smooth = value => value * value * (3 - 2 * value);

/** The book travels above the open rim, then falls into the actual hollow body.
 * All positions use the same world axes as the cabinet and its shared camera. */
export function sampleTrashDrop(start, mouth, progress, { height = 200, scale = 1, endScale = .19 } = {}) {
  const t = clamp(progress), travel = clamp(t / .68), amount = smooth(travel);
  const arc = Math.min(100, Math.max(28, Math.abs(start.y - mouth.y) * .16 + height * .2));
  const fall = smooth(clamp((t - .68) / .32));
  const position = start.clone().lerp(mouth, amount);
  position.y += Math.sin(travel * Math.PI) * arc - fall * height * endScale * 1.75;
  position.z += Math.sin(travel * Math.PI) * 36;
  // Make room for the cover before its broad face turns towards the camera.
  // Otherwise a book dragged into a narrow right gutter remains full-sized
  // while rotating and is visibly cut by the edge of the shared canvas.
  return { position, scale:scale + (endScale - scale) * smooth(clamp(t / .48)),
    turn:smooth(clamp(t / .76)), fall };
}

/** A powder-coated metal wastebasket with a real open wall, inner well and lid.
 * No texture downloads, canvas generation or idle animation are needed. */
export function createShelfTrash({ radius = 28, height = 88 } = {}) {
  radius = Math.max(12, Number(radius) || 28);
  height = Math.max(30, Number(height) || 88);
  const basket = new THREE.Group();
  basket.name = 'Shelf wastebasket';
  const coating = new THREE.MeshPhysicalMaterial({ color:'#305e48', metalness:.52, roughness:.36,
    clearcoat:.38, clearcoatRoughness:.3 });
  const interior = new THREE.MeshStandardMaterial({ color:'#20362b', metalness:.35, roughness:.66 });
  const trim = new THREE.MeshPhysicalMaterial({ color:'#b39c73', metalness:.82, roughness:.28 });
  const rubber = new THREE.MeshStandardMaterial({ color:'#252825', roughness:.96 });
  const profile = [
    [0, 0], [radius * .76, 0], [radius * .81, 2], [radius * .87, 7],
    [radius, height - 3], [radius * 1.018, height], [radius * .988, height + 1],
    [radius * .934, height], [radius * .925, height - 4], [radius * .79, 8],
    [radius * .74, 5], [0, 5]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const wallGeometry = new THREE.LatheGeometry(profile, 32);
  // One continuous cross-section supplies the outer taper, rolled rim and
  // inner wall, so a falling book is occluded by real solid surfaces.
  const wall = new THREE.Mesh(wallGeometry, coating); wall.name = 'Open metal body';
  basket.add(wall);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(radius * .76, radius * .76, 1, 24), interior);
  well.position.y = 5.3; well.name = 'Dark interior base'; basket.add(well);
  const foot = new THREE.Mesh(new THREE.TorusGeometry(radius * .80, 1.2, 6, 32), rubber);
  foot.rotation.x = Math.PI / 2; foot.position.y = .6; foot.name = 'Rubber foot'; basket.add(foot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * .974, 1.25, 8, 32), trim);
  rim.rotation.x = Math.PI / 2; rim.position.y = height + .1; rim.name = 'Rolled metal lip'; basket.add(rim);
  const lid = new THREE.Group(); lid.name = 'Hinged wastebasket lid';
  lid.position.set(0, height + 2, -radius * .91); basket.add(lid);
  const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.025, radius * 1.005, 3.4, 32), coating);
  lidTop.position.set(0, 0, radius * .91); lidTop.name = 'Solid lid'; lid.add(lidTop);
  const lidRim = new THREE.Mesh(new THREE.TorusGeometry(radius, .9, 6, 32), trim);
  lidRim.rotation.x = Math.PI / 2; lidRim.position.set(0, 1.7, radius * .91); lid.add(lidRim);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(radius * .14, 1.4, 6, 12, Math.PI), trim);
  handle.position.set(0, 2, radius * .91); handle.name = 'Lid handle'; lid.add(handle);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, radius * .43, 10), trim);
  hinge.rotation.z = Math.PI / 2; hinge.position.set(0, height + 1.8, -radius * .91);
  hinge.name = 'Lid axle'; basket.add(hinge);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(radius * .44, height * .015, .25), trim);
  badge.position.set(0, height * .62, radius * .947); badge.name = 'Subtle brass mark'; basket.add(badge);
  basket.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
  const geometries = new Set(), materials = new Set();
  basket.traverse(mesh => { if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) materials.add(mesh.material); });
  let disposed = false;
  basket.userData.trash = true;
  basket.userData.radius = radius; basket.userData.height = height;
  basket.userData.lid = lid;
  basket.userData.setState = ({ openness = 0, bounce = 0 } = {}) => {
    const open = clamp(openness);
    lid.rotation.x = -open * Math.PI * .49;
    lid.rotation.z = Math.sin(clamp(bounce) * Math.PI * 3) * .045 * (1 - clamp(bounce));
    basket.userData.openness = open;
  };
  basket.userData.getMouth = () => new THREE.Vector3(0, height + radius * .30, 0).applyMatrix4(basket.matrixWorld);
  basket.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  };
  basket.userData.setState();
  return basket;
}
