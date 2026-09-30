import * as THREE from 'three';

const QUADRANTS = { upright:[0, .5], leafy:[.5, .5], succulent:[0, 0], monstera:[.5, 0] };
const UP = new THREE.Vector3(0, 1, 0);

function randomFor(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function variantFor(value) {
  const variant = String(value || 'leafy').toLowerCase();
  if (variant.includes('cactus')) return 'cactus';
  if (variant.includes('monstera')) return 'monstera';
  if (variant === 'upright' || variant.includes('sansevieria')) return 'upright';
  if (variant.includes('succulent') || variant.includes('suculenta')) return 'succulent';
  return 'leafy';
}

function mineralTexture(random, color, roughness = false) {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  const base = new THREE.Color(color);
  if (!roughness) base.convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = (random() - .5) * .12;
    const wheelMark = Math.sin(y * 1.9) * .018 + Math.sin(y * .31) * .018;
    const pit = random() > .985 ? -.12 : 0;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) {
      const channel = [base.r, base.g, base.b][c];
      bytes[i + c] = Math.round(255 * Math.max(0, Math.min(1, roughness ? .84 + noise + pit : channel + noise + wheelMark + pit)));
    }
    bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.colorSpace = roughness ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function soilGeometry(radius, height, random) {
  const positions = [0, height, 0], uv = [.5, .5], indices = [];
  const segments = 24, rings = 4;
  for (let ring = 1; ring <= rings; ring++) for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2, r = radius * ring / rings;
    positions.push(Math.cos(angle) * r, height + (random() - .5) * radius * .025, Math.sin(angle) * r);
    uv.push(.5 + Math.cos(angle) * ring / rings / 2, .5 + Math.sin(angle) * ring / rings / 2);
  }
  for (let i = 0; i < segments; i++) indices.push(0, 1 + i + 1, 1 + i);
  for (let ring = 1; ring < rings; ring++) for (let i = 0; i < segments; i++) {
    const a = 1 + (ring - 1) * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, b + 1, b, a, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function bladePoint(f, u, length, width, variant, curve, twist) {
  const profile = variant === 'upright' ? Math.pow(Math.max(0, 1 - f * f), .68) * (.72 + .28 * Math.sin(f * Math.PI))
    : Math.pow(Math.sin(Math.PI * Math.pow(f, variant === 'leafy' ? .56 : .75)), .65);
  const lobes = variant === 'monstera' ? 1 - .24 * Math.pow(Math.sin(f * Math.PI * 5), 8) : 1;
  const x = width * .5 * profile * lobes * u;
  const bow = Math.sin(f * Math.PI * .85) * length * curve;
  const ridge = width * (variant === 'succulent' ? .13 : .065) * Math.pow(Math.abs(u), 1.5);
  const z = bow + ridge, angle = twist * f;
  return new THREE.Vector3(x * Math.cos(angle) + z * Math.sin(angle), f * length, z * Math.cos(angle) - x * Math.sin(angle));
}

function leafGeometry({ length, width, variant, curve, twist, atlas, random }) {
  const rows = variant === 'upright' ? 16 : variant === 'monstera' ? 14 : 12;
  const columns = variant === 'monstera' ? 10 : variant === 'leafy' ? 6 : 4;
  const thick = variant === 'succulent', thickness = thick ? width * .07 : 0;
  const positions = [], colors = [], uv = [], indices = [];
  const quadrant = QUADRANTS[variant], inset = .012;
  const tint = random() * .08;
  for (let side = 0; side <= Number(thick); side++) for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const f = row / rows, u = col / columns * 2 - 1;
    const point = bladePoint(f, u, length, width, variant, curve, twist);
    positions.push(point.x, point.y, point.z - side * thickness);
    uv.push(quadrant[0] + inset + col / columns * (.5 - inset * 2), quadrant[1] + inset + f * (.5 - inset * 2));
    const edge = Math.pow(Math.abs(u), 2), ridge = 1 - Math.abs(u);
    if (atlas) colors.push(.94 + tint - edge * .035, .96 + tint - edge * .02, .92 + tint - edge * .035);
    else colors.push(.23 + ridge * .11 + tint + edge * .04, .36 + ridge * .15 + tint, .16 + ridge * .075 + tint * .5);
  }
  const count = (rows + 1) * (columns + 1);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const f = (row + .5) / rows, u = Math.abs((col + .5) / columns * 2 - 1);
    // Genuine gaps between the rib and lobes supplement the photographed
    // fenestrations; the leaf's curve and silhouette remain real geometry.
    if (variant === 'monstera' && u > .15 && u < .48 && [ .32, .54, .74 ].some(center => Math.abs(f - center) < .045)) continue;
    const a = row * (columns + 1) + col, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, b, d, a, d, c);
    if (thick) indices.push(a + count, d + count, b + count, a + count, c + count, d + count);
  }
  if (thick) {
    const edge = (a, b) => indices.push(a, a + count, b + count, a, b + count, b);
    for (let row = 0; row < rows; row++) { edge(row * (columns + 1), (row + 1) * (columns + 1)); edge((row + 1) * (columns + 1) + columns, row * (columns + 1) + columns); }
    for (let col = 0; col < columns; col++) { edge(col + 1, col); edge(rows * (columns + 1) + col, rows * (columns + 1) + col + 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length).fill(0), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function cactusCap(f) {
  const end = f < .15 ? f / .15 - 1 : f > .85 ? (f - .85) / .15 : 0;
  return Math.sqrt(Math.max(0, 1 - end * end));
}

function cactusGeometry(length, radius, bend, random) {
  const positions = [], colors = [], uv = [], indices = [], rows = 12, columns = 24;
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const f = row / rows, angle = col / columns * Math.PI * 2;
    const cap = cactusCap(f);
    const ridge = .87 + .13 * Math.cos(angle * 8), r = radius * cap * ridge;
    positions.push(Math.cos(angle) * r + bend * f * f, length * f, Math.sin(angle) * r);
    const green = .30 + .07 * Math.cos(angle * 8) + random() * .025;
    colors.push(green * .68, green, green * .60); uv.push(col / columns, f);
    if (row < rows && col < columns) {
      const a = row * (columns + 1) + col, b = a + 1, c = a + columns + 1, d = c + 1;
      indices.push(a, d, b, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Stable, bounded botanical meshes; the optional atlas is owned by the scene. */
export function createShelfPlant(entry, { leafTexture = null } = {}) {
  const width = Math.max(1, Number(entry.width) || 46), height = Math.max(1, Number(entry.height) || 70);
  const variant = variantFor(entry.variant), seed = entry.seed ?? entry.key ?? entry.node?.dataset.objectId ?? variant;
  const random = randomFor(seed), group = new THREE.Group(), content = new THREE.Group();
  content.position.y = -height / 2; group.add(content);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  const mesh = (geometry, material, name) => {
    geometries.add(geometry); materials.add(material);
    const object = new THREE.Mesh(geometry, material); object.name = name;
    object.castShadow = true; object.receiveShadow = true; content.add(object); return object;
  };
  const potHeight = height * (variant === 'succulent' ? .37 : .29), radius = width * .275;
  const clays = ['#a97958', '#b18b6c', '#bcad94', '#826d60'];
  const clayMap = mineralTexture(random, clays[Math.floor(random() * clays.length)]), roughMap = mineralTexture(random, '#ffffff', true);
  textures.add(clayMap); textures.add(roughMap);
  const clay = new THREE.MeshStandardMaterial({ map:clayMap, roughnessMap:roughMap, bumpMap:roughMap,
    bumpScale:width * .007, roughness:.95, metalness:0 });
  const profile = [[.71,0],[.76,.025],[.80,.07],[.97,.86],[1.03,.92],[1.055,.96],[1.035,.985],[.99,1],[.945,.975],[.925,.91],[.70,.11],[0,.11],[0,0]]
    .map(([r,y]) => new THREE.Vector2(radius * r, potHeight * y));
  mesh(new THREE.LatheGeometry(profile, 24), clay, 'ceramic-pot');
  const soilY = potHeight * .90, soilMap = mineralTexture(random, '#443a2b'); textures.add(soilMap);
  mesh(soilGeometry(radius * .90, soilY, random), new THREE.MeshStandardMaterial({ map:soilMap, roughness:1, bumpMap:roughMap, bumpScale:width * .009 }), 'potting-soil');
  const mineral = new THREE.MeshStandardMaterial({ color:'#9b9282', roughness:1 });
  for (let i = 0; i < 6; i++) {
    const angle = random() * Math.PI * 2, r = radius * .72 * Math.sqrt(random()), size = width * (.012 + random() * .012);
    const stone = mesh(new THREE.IcosahedronGeometry(size, 0), mineral, 'soil-mineral');
    stone.scale.set(1.2, .55, .85); stone.position.set(Math.cos(angle) * r, soilY + size * .25, Math.sin(angle) * r);
    stone.rotation.set(random(), random(), random());
  }
  const stemMaterial = new THREE.MeshStandardMaterial({ color:'#596a39', roughness:.83 });
  const veinMaterial = new THREE.MeshStandardMaterial({ color:leafTexture ? '#a0ad70' : '#718747', roughness:.83 });
  const leafMaterial = new THREE.MeshPhysicalMaterial({ map:leafTexture, color:0xffffff, vertexColors:true,
    side:THREE.DoubleSide, alphaTest:leafTexture ? .17 : 0, alphaToCoverage:Boolean(leafTexture),
    roughness:variant === 'succulent' ? .57 : .74, metalness:0,
    clearcoat:variant === 'succulent' ? .18 : .035, clearcoatRoughness:.65 });
  const tube = (points, r, material, name, segments = 6) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, r, 4, false), material, name);
  const blade = (position, direction, length, leafWidth, angle, curve, twist, index) => {
    const parameters = { length, width:leafWidth, variant, curve, twist, atlas:Boolean(leafTexture), random };
    const leaf = mesh(leafGeometry(parameters), leafMaterial, `leaf-${index}`);
    leaf.position.copy(position);
    leaf.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
    leaf.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, angle));
    const points = [0,.20,.43,.67,.90].map(f => bladePoint(f, 0, length, leafWidth, variant, curve, twist).applyQuaternion(leaf.quaternion).add(position));
    tube(points, width * .0015, veinMaterial, `leaf-vein-${index}`);
    return leaf;
  };
  if (variant === 'cactus') {
    const green = new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.8 });
    const spikes = [], columns = [ {x:0,z:0,length:height * .71,radius:width * .12},
      {x:-width*.18,z:width*.035,length:height*.47,radius:width*.085},
      {x:width*.19,z:-width*.065,length:height*.36,radius:width*.083} ];
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index], bend = (random() - .5) * width * .09;
      const stem = mesh(cactusGeometry(column.length, column.radius, bend, random), green, `cactus-column-${index}`);
      stem.position.set(column.x, soilY, column.z);
      for (let row = 1; row < 7; row++) for (let ridge = 0; ridge < 8; ridge++) {
        const f = row / 8, angle = ridge / 8 * Math.PI * 2, radiusAt = column.radius * cactusCap(f);
        const p = new THREE.Vector3(column.x + Math.cos(angle) * radiusAt + bend * f * f, soilY + column.length * f, column.z + Math.sin(angle) * radiusAt);
        for (const tilt of [-.45,.45]) {
          const tip = p.clone().add(new THREE.Vector3(Math.cos(angle) * width * .023, width * .018 * tilt, Math.sin(angle) * width * .023));
          spikes.push(...p.toArray(), ...tip.toArray());
        }
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(spikes, 3));
    const material = new THREE.LineBasicMaterial({ color:'#d4c7a4', transparent:true, opacity:.8 });
    const needles = new THREE.LineSegments(geometry, material); needles.name = 'cactus-areoles'; content.add(needles);
    geometries.add(geometry); materials.add(material);
  } else if (variant === 'upright') {
    for (let i = 0; i < 8; i++) {
      const angle = i * 2.39996, spread = width * (.045 + (i % 3) * .028);
      const position = new THREE.Vector3(Math.cos(angle) * spread, soilY, Math.sin(angle) * spread);
      const direction = new THREE.Vector3(Math.cos(angle) * (.06 + (i % 3) * .035), 1, Math.sin(angle) * .055);
      blade(position, direction, height * (i === 0 ? .74 : .50 + random() * .21), width * (.24 + random() * .055), angle * .38,
        .035 + random() * .03, (random() - .5) * .22, i);
    }
  } else if (variant === 'succulent') {
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.39996, ring = i < 5 ? .55 : .22;
      const direction = new THREE.Vector3(Math.cos(angle) * ring, .65 + (i % 3) * .10, Math.sin(angle) * ring);
      blade(new THREE.Vector3(Math.cos(angle) * width * .03, soilY, Math.sin(angle) * width * .03), direction,
        height * (i < 5 ? .58 : .51), width * (.22 + random() * .035), angle, .09, (random() - .5) * .24, i);
    }
  } else if (variant === 'leafy') {
    // A pothos grows along bent vines. Vary the leaf levels and include two
    // lower, hanging hearts instead of arranging all leaves as an upright fan.
    const leaves = [
      { x:0, z:-.04, y:.33, axis:[.04,1,.04], length:.38, width:.44 },
      { x:-.16, z:-.08, y:.24, axis:[-.48,.88,.05], length:.35, width:.45 },
      { x:.16, z:-.07, y:.21, axis:[.50,.85,.07], length:.35, width:.45 },
      { x:-.17, z:.04, y:.17, axis:[-.70,.62,.10], length:.32, width:.43 },
      { x:.16, z:.06, y:.15, axis:[.73,.60,.12], length:.31, width:.42 },
      { x:-.20, z:.12, y:.18, axis:[-.53,-.68,.15], length:.25, width:.38 },
      { x:.20, z:.10, y:.20, axis:[.52,-.66,.13], length:.26, width:.39 },
      { x:.025, z:-.13, y:.28, axis:[-.12,.96,-.18], length:.30, width:.34 }
    ];
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i], endpoint = new THREE.Vector3(leaf.x * width, soilY + leaf.y * height, leaf.z * width);
      const root = new THREE.Vector3(leaf.x * width * .13, soilY, leaf.z * width * .13);
      const middle = new THREE.Vector3(endpoint.x * .42, soilY + height * (i === 5 || i === 6 ? .26 : leaf.y * .65), endpoint.z * .45);
      tube([root, middle, endpoint], width * .008, stemMaterial, `petiole-${i}`, 8);
      blade(endpoint, new THREE.Vector3(...leaf.axis), height * leaf.length, width * leaf.width,
        (random() - .5) * .36, .08 + random() * .05, (random() - .5) * .26, i);
    }
  } else {
    const count = variant === 'monstera' ? 5 : 8;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996 + .30, spread = width * (.10 + random() * .075);
      const endpoint = new THREE.Vector3(Math.cos(angle) * spread, soilY + height * (.22 + random() * .14), Math.sin(angle) * spread * .8);
      const root = new THREE.Vector3(Math.cos(angle) * width * .025, soilY, Math.sin(angle) * width * .025);
      tube([root, new THREE.Vector3(endpoint.x * .34, soilY + height * .13, endpoint.z * .34), endpoint], width * (variant === 'monstera' ? .012 : .008), stemMaterial, `petiole-${i}`, 8);
      const direction = new THREE.Vector3(Math.cos(angle) * .35, 1, Math.sin(angle) * .18);
      blade(endpoint, direction, height * (variant === 'monstera' ? .38 : .34), width * (variant === 'monstera' ? .43 : .32),
        Math.sin(angle) * .6, .11 + random() * .045, (random() - .5) * .40, i);
    }
  }
  // Fit foliage, rim and stems to the promised shelf collision envelope.
  // The ceramic base remains exactly at -height/2 when dimensions vary.
  const bounds = new THREE.Box3().setFromObject(content), size = new THREE.Vector3(); bounds.getSize(size);
  const xExtent = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  const zExtent = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  content.scale.set(Math.min(1, width / 2 / xExtent), height / (bounds.max.y + height / 2), Math.min(1, width * .35 / zExtent));
  group.userData.variant = variant; group.userData.seed = String(seed); group.userData.atlasQuadrant = QUADRANTS[variant] ?? null;
  let disposed = false;
  group.userData.dispose = () => {
    if (disposed) return; disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };
  // Materials created for an unused variant do not enter the scene traversal.
  for (const material of [stemMaterial, veinMaterial, leafMaterial]) if (!materials.has(material)) material.dispose();
  return group;
}

export default createShelfPlant;
