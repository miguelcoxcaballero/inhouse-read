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

/** Fine orange-peel texture of a powder coat: R relief, G roughness. A tiny
 * deterministic 64px field, generated once per bin; no downloads or idle work. */
function powderCoat() {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  const lattice = (x, y) => {
    let h = Math.imul((x & 15) + 1, 0x27d4eb2d) ^ Math.imul((y & 15) + 1, 0x165667b1);
    h = Math.imul(h ^ h >>> 15, 0x85ebca6b); return ((h ^ h >>> 13) >>> 0) / 4294967296;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / 4, v = y / 4, xi = Math.floor(u), yi = Math.floor(v), fx = smooth(u - xi), fy = smooth(v - yi);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi), c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    const peel = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy, i = (y * size + x) * 4;
    bytes[i] = Math.round(255 * (.35 + peel * .3)); bytes[i + 1] = Math.round(255 * (.82 + peel * .18));
    bytes[i + 2] = 0; bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(12, 12);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

/** Lathe UVs follow the profile's arc length so the coat texture is not
 * stretched along long straight walls. */
function arcLengthUV(geometry, points) {
  const lengths = [0];
  for (let j = 1; j < points.length; j++) lengths.push(lengths[j - 1] + points[j].distanceTo(points[j - 1]));
  const uv = geometry.attributes.uv, total = lengths[lengths.length - 1] || 1;
  for (let i = 0; i < uv.count; i++) uv.setY(i, lengths[i % points.length] / total);
  return geometry;
}

/** A powder-coated steel pedal bin: rolled rim, removable inner bucket,
 * moulded base with a brushed-steel pedal and a domed stainless lid on a rear
 * hinge. Opening remains the lid's rotation about its back axle. */
export function createShelfTrash({ radius = 44, height = 140 } = {}) {
  radius = Math.max(12, Number(radius) || 44);
  height = Math.max(30, Number(height) || 140);
  const basket = new THREE.Group();
  basket.name = 'Shelf wastebasket';
  const peel = powderCoat(), textures = new Set([peel]);
  // Vertex colours carry the coat, the grey bucket and its interior shadow,
  // so one shell and one material cover all three. A satin clearcoat
  // mirrors the room's window as a soft vertical streak, which is what makes
  // a small cylinder read as round rather than as a flat green panel.
  const coating = new THREE.MeshPhysicalMaterial({ color:'#ffffff', vertexColors:true, metalness:.12, roughness:.46,
    roughnessMap:peel, bumpMap:peel, bumpScale:.16, clearcoat:.6, clearcoatRoughness:.2 });
  const interior = new THREE.MeshStandardMaterial({ color:'#151716', roughness:.8 });
  const steel = new THREE.MeshPhysicalMaterial({ color:'#dfe2e3', metalness:1, roughness:.2, clearcoat:.3, clearcoatRoughness:.12 });
  const plastic = new THREE.MeshStandardMaterial({ color:'#1b1d1c', roughness:.5 });
  // Brushed stainless lid; vertex colours darken its liner and the black
  // gasket ring whose shadow line separates it from the steel collar.
  const lidSteel = new THREE.MeshPhysicalMaterial({ color:'#ffffff', vertexColors:true, metalness:1, roughness:.27,
    clearcoat:.35, clearcoatRoughness:.14 });
  const coat = new THREE.Color('#3f6752'), bucket = new THREE.Color('#3a3d3b'), shade = new THREE.Color();
  const base = 9.5, collar = height - 6.5, segments = 36;
  // x factors of the radius, absolute y. The body flares gently from its
  // foot to the steel collar, rolls over and becomes the bucket inside.
  const shell = [
    [.93, base - 1.5], [.935, base + 2], [.975, height * .55], [.994, collar - 2], [.998, collar + 1],
    [.999, height - .3], [.976, height], [.957, height - 1.5], [.952, height - 3.2], [.94, height - 3.6],
    [.932, height - 7], [.9, height * .45], [.868, base + 1.5], [.84, base], [0, base]
  ];
  const outer = 6, profile = shell.map(([x, y]) => new THREE.Vector2(radius * x, y));
  const wallGeometry = arcLengthUV(new THREE.LatheGeometry(profile, segments), profile), colors = [];
  for (let i = 0; i <= segments; i++) for (let j = 0; j < shell.length; j++) {
    if (j < outer) {
      // Occlusion under the collar and above the black base gives the drum its ends.
      shade.copy(coat).multiplyScalar(j < 2 ? .62 : j === 3 ? .9 : j === 4 ? .7 : 1);
    } else {
      const depth = clamp((height - shell[j][1]) / (height - base));
      shade.copy(bucket).multiplyScalar(1 - .82 * Math.pow(depth, .6));
    }
    colors.push(shade.r, shade.g, shade.b);
  }
  wallGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // The shelf camera looks down on the bin, so a true vertical wall mirrors
  // only the dark floor. Leaning the drum's shading normals slightly upwards
  // lets the window and key light sweep a soft vertical sheen across it.
  const lean = new THREE.Vector3(), leanNormals = (geometry, rows, from, to, amount) => {
    const normal = geometry.attributes.normal;
    for (let i = 0; i <= segments; i++) for (let j = from; j <= to; j++) {
      const k = i * rows + j;
      lean.fromBufferAttribute(normal, k); lean.y += amount; lean.normalize(); normal.setXYZ(k, lean.x, lean.y, lean.z);
    }
  };
  leanNormals(wallGeometry, shell.length, 1, outer - 2, .38);
  // One continuous cross-section supplies the outer wall, rolled rim and
  // inner bucket, so a falling book is occluded by real solid surfaces.
  const wall = new THREE.Mesh(wallGeometry, coating); wall.name = 'Open metal body';
  basket.add(wall);
  const well = new THREE.Mesh(new THREE.CylinderGeometry(radius * .845, radius * .845, 1, 24), interior);
  well.position.y = base + .4; well.name = 'Dark interior base'; basket.add(well);
  // A raised moulded foot, a touch wider than the body it carries.
  const footProfile = [[0, 0], [.975, 0], [1.0, .5], [1.012, 2.2], [1.01, 8.6], [.99, 10.8], [.94, 11.6]]
    .map(([x, y]) => new THREE.Vector2(radius * x, y));
  const foot = new THREE.Mesh(new THREE.LatheGeometry(footProfile, segments), plastic);
  foot.name = 'Rubber foot'; basket.add(foot);
  // Broad brushed pedal on a short arm, turned a little towards the shelf's
  // camera so its lit top and front edge read even when the bin is small.
  const pedalShape = new THREE.Shape();
  const pw = radius * .3, pd = radius * .27;
  pedalShape.moveTo(-pw * .8, 0); pedalShape.lineTo(-pw * .94, pd * .7);
  pedalShape.quadraticCurveTo(-pw, pd, -pw * .76, pd); pedalShape.lineTo(pw * .76, pd);
  pedalShape.quadraticCurveTo(pw, pd, pw * .94, pd * .7); pedalShape.lineTo(pw * .8, 0); pedalShape.lineTo(-pw * .8, 0);
  const pedalGeometry = new THREE.ExtrudeGeometry(pedalShape, { depth:2.6, bevelEnabled:true, bevelThickness:.8, bevelSize:.8, bevelSegments:2, curveSegments:4 });
  pedalGeometry.rotateX(Math.PI / 2);
  const pedal = new THREE.Mesh(pedalGeometry, steel); pedal.name = 'Pedal';
  // At rest the tread tips up, which also shows its lit top to the camera.
  const turn = .48;
  pedal.position.set(Math.sin(turn) * radius * .95, 6.4, Math.cos(turn) * radius * .95); pedal.rotation.set(-.3, turn, 0, 'YXZ');
  basket.add(pedal);
  // Polished collar: a steel band with a rolled bead that the lid closes on.
  const collarProfile = [[1.004, collar - .6], [1.014, collar], [1.016, height - 2.2], [1.024, height - 1.2], [1.022, height - .2], [1.0, height + .4], [.975, height + .2]]
    .map(([x, y]) => new THREE.Vector2(radius * x, y));
  const collarGeometry = new THREE.LatheGeometry(collarProfile, segments);
  leanNormals(collarGeometry, collarProfile.length, 0, 3, .5);
  const rim = new THREE.Mesh(collarGeometry, steel);
  rim.name = 'Rolled metal lip'; basket.add(rim);
  const lid = new THREE.Group(); lid.name = 'Hinged wastebasket lid';
  lid.position.set(0, height + 2.4, -radius * .91); basket.add(lid);
  // Domed lid: a black gasket at the foot of its skirt (the seam line against
  // the collar), a bright rolled edge, then the dome.
  const lidShape = [[.99, -2.3], [1.03, -2.6], [1.044, -1.9], [1.046, -.7], [1.047, -.6], [1.046, .6],
    [1.036, 1.4], [1.0, 2.0], [.86, 3.5], [.64, 5.6], [.36, 7.1], [0, 7.7]];
  const lidProfile = lidShape.map(([x, y]) => new THREE.Vector2(radius * x, y));
  const lidGeometry = arcLengthUV(new THREE.LatheGeometry(lidProfile, segments), lidProfile), lidColors = [];
  for (let i = 0; i < lidGeometry.attributes.position.count; i++) {
    const j = i % lidShape.length;
    shade.set(j < 4 ? '#141515' : j === 6 || j === 7 ? '#f2f3f3' : '#cdd0d1');
    lidColors.push(shade.r, shade.g, shade.b);
  }
  lidGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lidColors, 3));
  leanNormals(lidGeometry, lidShape.length, 4, 5, .5);
  const lidTop = new THREE.Mesh(lidGeometry, lidSteel);
  lidTop.position.set(0, 0, radius * .91); lidTop.name = 'Solid lid'; lid.add(lidTop);
  // Underneath, a moulded grey liner (not polished steel), so the raised lid
  // reads as a lid seen from below rather than as a black disc. It is shaded
  // darker towards the skirt, which hides it when the lid is closed.
  const linerShape = [[0, 1.6], [.62, 1.05], [.9, .3], [.99, -2.3]], linerTones = ['#72777a', '#676c6f', '#4f5356', '#303334'];
  const linerGeometry = new THREE.LatheGeometry(linerShape.map(([x, y]) => new THREE.Vector2(radius * x, y)), segments), linerColors = [];
  for (let i = 0; i < linerGeometry.attributes.position.count; i++) {
    shade.set(linerTones[i % linerShape.length]); linerColors.push(shade.r, shade.g, shade.b);
  }
  linerGeometry.setAttribute('color', new THREE.Float32BufferAttribute(linerColors, 3));
  const liner = new THREE.Mesh(linerGeometry, new THREE.MeshStandardMaterial({ color:'#ffffff', vertexColors:true, roughness:.62 }));
  liner.position.copy(lidTop.position); liner.name = 'Lid liner'; lid.add(liner);
  // Moulded rear hinge block; the lid pivots on its axle.
  const hinge = new THREE.Mesh(new THREE.CapsuleGeometry(2.3, radius * .34, 2, 8), plastic);
  hinge.rotation.z = Math.PI / 2; hinge.position.set(0, height + 1.6, -radius * 1.02);
  hinge.name = 'Lid axle'; basket.add(hinge);
  // The bucket's carry handle lies folded against the inside of the rim.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(radius * .905, .55, 4, 24, Math.PI * .9), plastic);
  handle.rotation.x = Math.PI / 2; handle.rotation.z = Math.PI * .05; handle.position.y = height - 5.2; handle.name = 'Bucket handle';
  basket.add(handle);
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
    for (const texture of textures) texture.dispose();
  };
  basket.userData.setState();
  return basket;
}
