import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getCatalogPot } from './plant-catalog-data.js';
import { resolveCatalogPlant } from './plant-records.js';

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
  if (variant.includes('chamaedorea') || variant === 'palm') return 'palm';
  if (variant.includes('nephrolepis') || variant === 'fern') return 'fern';
  if (variant.includes('hedera') || variant === 'ivy') return 'ivy';
  if (variant.includes('zamioculcas') || variant === 'zz') return 'zz';
  return 'leafy';
}

function botanicalTexture(random, variant) {
  const size = 128, bytes = new Uint8Array(size * size * 4);
  const base = new THREE.Color(variant === 'zz' ? '#315525' : variant === 'fern' ? '#4d792e' : variant === 'succulent' ? '#63816c' : '#36672c').convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = Math.abs(x / (size - 1) * 2 - 1), v = y / (size - 1);
    const midrib = Math.exp(-u * 38) * (variant === 'succulent' ? .012 : .075);
    const lateral = Math.pow(Math.max(0,Math.cos((v * 9 - u * .85) * Math.PI * 2)),28) * (variant === 'succulent' ? .006 : .035) * (1 - u);
    const margin = variant === 'ivy' ? Math.pow(u,5) * .12 : 0;
    const snakeBand = variant === 'upright' ? (Math.sin(v * 74 + Math.sin(u * 7) * 2) * .045 + Math.cos(v * 33 - u * 4) * .025) * (1 - u*.3) : 0;
    const snakeMargin = variant === 'upright' ? Math.max(0,(u-.82)/.18) : 0;
    const noise = (random() - .5) * .035;
    const i = (y * size + x) * 4;
    bytes[i] = Math.min(255,Math.round((base.r + midrib + lateral + margin + noise + snakeBand + snakeMargin*.22) * 255));
    bytes[i+1] = Math.min(255,Math.round((base.g + midrib + lateral + margin + noise + snakeBand + snakeMargin*.16) * 255));
    bytes[i+2] = Math.min(255,Math.round((base.b + midrib * .5 + lateral * .6 + margin + noise + snakeBand*.7 - snakeMargin*.055) * 255));
    bytes[i+3] = 255;
  }
  const texture = new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true; return texture;
}

function detailedPotGeometry(radius, height, potId) {
  const profile = [];
  if (potId === 'muskot') {
    // Broad lower horizontal bands, as on the real white MUSKOT.
    profile.push([.76,0],[.80,.025]);
    for (let i = 0; i <= 20; i++) {
      const y = .04 + i / 20 * .54, r = .81 + y * .20 + .019 * Math.sin(i * Math.PI / 2);
      profile.push([r,y]);
    }
    profile.push([.98,.92],[1,.97],[.995,1],[.947,1],[.93,.965],[.91,.88],[.72,.09],[0,.09],[0,0]);
  } else if (potId === 'gradvis') {
    profile.push([.53,0],[.64,.025],[.76,.08],[.86,.16],[.93,.27],[.97,.39],[.99,.54],[1,.95],[.99,1],[.94,1],[.94,.96],[.93,.51],[.87,.29],[.76,.16],[0,.12],[0,0]);
  } else if (potId === 'akerbar') {
    profile.push([.78,0],[.81,.015],[.81,.035],[.785,.048],[.79,.085],[.97,.95],[1,.971],[1.018,.99],[1,1.011],[.98,1.014],[.96,1],[.957,.983],[.957,.96],[.772,.07],[0,.055],[0,0]);
  } else {
    profile.push([.68,0],[.72,.025],[.74,.06],[.91,.81],[.99,.84],[1.01,.90],[1.01,.97],[.99,1],[.93,1],[.915,.95],[.915,.88],[.68,.10],[0,.10],[0,0]);
  }
  const geometry = new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r * radius,y * height)),potId === 'gradvis' ? 96 : 48);
  if (potId === 'gradvis') {
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
      const r = Math.hypot(x,z), angle = Math.atan2(x,z);
      // A shallow rounded flute follows the rounded foot; inside stays smooth.
      const outer = i % profile.length < 9;
      const amplitude = outer ? radius * .012 * Math.sin(Math.min(1,y / height * 7) * Math.PI / 2) * Math.max(0,Math.min(1,(height - y) / height * 14)) : 0;
      const adjusted = r + Math.cos(angle * 48) * amplitude;
      if (r) positions.setXYZ(i,x / r * adjusted,y,z / r * adjusted);
    }
    positions.needsUpdate = true; geometry.computeVertexNormals();
  }
  return geometry;
}

function mineralTexture(random, color, roughness = false, grain = 1) {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  const base = new THREE.Color(color);
  if (!roughness) base.convertLinearToSRGB();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = (random() - .5) * .12 * grain;
    const wheelMark = (Math.sin(y * 1.9) * .018 + Math.sin(y * .31) * .018) * grain;
    const pit = random() > .985 ? -.12 * grain : 0;
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
    : Math.pow(Math.max(0,Math.sin(Math.PI * Math.pow(f, variant === 'leafy' || variant === 'ivy' ? .56 : .75))), variant === 'zz' ? .45 : .65);
  const lobes = variant === 'monstera' ? 1 - .54 * Math.pow(Math.sin(f * Math.PI * 5), 8)
    : variant === 'ivy' ? .53 + .47 * Math.pow(Math.cos(f * Math.PI * 3.3 - .2),2)
    : variant === 'fern' ? .92 + .08 * Math.cos(f * Math.PI * 14) : 1;
  const x = width * .5 * profile * lobes * u;
  const bow = Math.sin(f * Math.PI * .85) * length * curve;
  const ridge = width * (variant === 'succulent' ? .13 : .065) * Math.pow(Math.abs(u), 1.5);
  const z = bow + ridge, angle = twist * f;
  return new THREE.Vector3(x * Math.cos(angle) + z * Math.sin(angle), f * length, z * Math.cos(angle) - x * Math.sin(angle));
}

function leafGeometry({ length, width, variant, curve, twist, random, detailed = false }) {
  const rows = variant === 'palm' ? 4 : variant === 'fern' ? 3 : variant === 'zz' ? 6 : variant === 'ivy' || (variant === 'succulent' && detailed) ? 8 : variant === 'upright' ? 16 : variant === 'monstera' ? 14 : 12;
  const columns = variant === 'palm' || variant === 'fern' ? 2 : variant === 'monstera' ? 10 : variant === 'leafy' ? 6 : 4;
  const thick = variant === 'succulent' || detailed, thickness = thick ? width * (variant === 'succulent' ? (detailed ? .13 : .07) : .008) : 0;
  const positions = [], colors = [], uv = [], indices = [];
  const inset = .012;
  const tint = random() * .08;
  for (let side = 0; side <= Number(thick); side++) for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const f = row / rows, u = col / columns * 2 - 1;
    const point = bladePoint(f, u, length, width, variant, curve, twist);
    positions.push(point.x, point.y, point.z - side * thickness);
    uv.push(inset + col / columns * (1 - inset * 2), inset + f * (1 - inset * 2));
    const edge = Math.pow(Math.abs(u), 2), ridge = 1 - Math.abs(u);
    if (detailed) colors.push(.78 + ridge * .12 + tint, .85 + ridge * .10 + tint, .73 + ridge * .12 + tint);
    else colors.push(.23 + ridge * .11 + tint + edge * .04, .36 + ridge * .15 + tint, .16 + ridge * .075 + tint * .5);
  }
  const count = (rows + 1) * (columns + 1);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const f = (row + .5) / rows, u = Math.abs((col + .5) / columns * 2 - 1);
    // Genuine gaps between the rib and lobes remain part of the geometry.
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

function ivyLeafGeometry(length,width,curve,random) {
  // Five pointed lobes with deep sinuses form the real silhouette rather than
  // a rectangular alpha card. Concentric folds cup the entire leaf in 3D.
  const outline = [[0,0],[-.22,.14],[-.49,.28],[-.28,.43],[-.47,.68],[-.22,.64],[0,1],[.22,.64],[.47,.68],[.28,.43],[.49,.28],[.22,.14]];
  const positions = [], uv = [], colors = [], indices = [], rings = 3, segments = outline.length, thickness = width*.007;
  const center = new THREE.Vector3(0,length*.44,length*curve*.75), tint = random()*.045;
  for (let side = 0; side < 2; side++) {
    for (let ring = 0; ring <= rings; ring++) for (const [x,y] of outline) {
      const f = ring / rings;
      const px = x*width*f, py = center.y + (y*length-center.y)*f;
      const pz = center.z + Math.abs(x)*width*.055*f + Math.sin(y*Math.PI)*length*curve*.2*f - side*thickness;
      positions.push(px,py,pz); uv.push(.5+px/width,py/length);
      colors.push(.86+tint,.92+tint,.83+tint);
    }
  }
  const count = (rings+1)*segments;
  for (let ring = 0; ring < rings; ring++) for (let j = 0; j < segments; j++) {
    const next = (j+1)%segments, a = ring*segments+j, b = ring*segments+next, c = a+segments, d = b+segments;
    indices.push(a,b,d,a,d,c,a+count,d+count,b+count,a+count,c+count,d+count);
  }
  for (let j = 0; j < segments; j++) {
    const a = rings*segments+j,b = rings*segments+(j+1)%segments;
    indices.push(a,a+count,b+count,a,b+count,b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function monsteraLeafGeometry(length,width,curve,random) {
  // Cordate base, rounded lobes and deep curved slits. Two pairs of closed
  // fenestrations are actual holes through both surfaces of the lamina.
  const shape = new THREE.Shape();
  shape.moveTo(0,.12);
  shape.bezierCurveTo(-.14,-.02,-.45,.005,-.50,.19);
  shape.quadraticCurveTo(-.55,.28,-.50,.37);
  shape.bezierCurveTo(-.43,.37,-.30,.31,-.22,.33);
  shape.quadraticCurveTo(-.27,.40,-.46,.45);
  shape.quadraticCurveTo(-.47,.50,-.42,.57);
  shape.bezierCurveTo(-.32,.57,-.18,.49,-.13,.53);
  shape.quadraticCurveTo(-.22,.63,-.35,.66);
  shape.quadraticCurveTo(-.31,.72,-.27,.78);
  shape.quadraticCurveTo(-.17,.70,-.10,.66);
  shape.quadraticCurveTo(-.14,.78,-.22,.85);
  shape.quadraticCurveTo(-.10,.94,0,1);
  shape.quadraticCurveTo(.10,.94,.22,.85);
  shape.quadraticCurveTo(.14,.78,.10,.66);
  shape.quadraticCurveTo(.17,.70,.27,.78);
  shape.quadraticCurveTo(.31,.72,.35,.66);
  shape.quadraticCurveTo(.22,.63,.13,.53);
  shape.bezierCurveTo(.18,.49,.32,.57,.42,.57);
  shape.quadraticCurveTo(.47,.50,.46,.45);
  shape.quadraticCurveTo(.27,.40,.22,.33);
  shape.bezierCurveTo(.30,.31,.43,.37,.50,.37);
  shape.quadraticCurveTo(.55,.28,.50,.19);
  shape.bezierCurveTo(.45,.005,.14,-.02,0,.12);
  for (const side of [-1,1]) for (const [x,y,rx,ry] of [[.19,.24,.042,.065],[.095,.43,.030,.062]]) {
    const hole = new THREE.Path(); hole.absellipse(side*x,y,rx,ry,0,Math.PI*2,true,side*-.30); shape.holes.push(hole);
  }
  const surface = new THREE.ShapeGeometry(shape,5), source = surface.attributes.position, count = source.count;
  const positions = [], uv = [], colors = [], indices = [], edges = new Map(), tint = random()*.035;
  for (let side = 0; side < 2; side++) for (let i = 0; i < count; i++) {
    const x = source.getX(i), y = source.getY(i);
    positions.push(x*width,(y-.12)*length,Math.sin(y*Math.PI)*length*curve + x*x*width*.15 - side*width*.009);
    uv.push(.5+x,y); colors.push(.85+tint,.93+tint,.81+tint);
  }
  const edge = (a,b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edges.has(key)) edges.delete(key); else edges.set(key,[a,b]);
  };
  const src = surface.index.array;
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i],b = src[i+1],c = src[i+2];
    indices.push(a,b,c,a+count,c+count,b+count); edge(a,b); edge(b,c); edge(c,a);
  }
  for (const [a,b] of edges.values()) indices.push(a,a+count,b+count,a,b+count,b);
  surface.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.userData.fenestrations = 4;
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

function consolidateParts(content, mesh, geometries) {
  // Botanical complexity is built as individual parts, then consolidated by
  // material. Hundreds of fern pinnae still require only a handful of draws.
  const parts = content.children.map(object => object.name);
  const batches = new Map();
  for (const object of [...content.children]) {
    if (!object.isMesh || object.name === 'ceramic-pot' || object.name === 'leaf-0') continue;
    const objects = batches.get(object.material) || []; objects.push(object); batches.set(object.material,objects);
  }
  for (const [material,objects] of batches) {
    if (objects.length < 2) continue;
    const prepared = objects.map(object => {
      object.updateMatrix(); return object.geometry.clone().applyMatrix4(object.matrix);
    });
    const merged = mergeGeometries(prepared,false);
    for (const geometry of prepared) geometry.dispose();
    if (!merged) continue;
    for (const object of objects) {
      object.geometry.dispose(); geometries.delete(object.geometry); content.remove(object);
    }
    const batch = mesh(merged,material,`${objects[0].name.split('-')[0]}-batch`);
    batch.userData.parts = objects.map(object => object.name);
  }
  return parts;
}

/** Every saved plant uses a current catalog mesh, including legacy records.
 * Its own opaque leaf texture covers real geometry; no photo cutout is used.
 */
export function createShelfPlant(entry) {
  const catalogPlant = resolveCatalogPlant(entry);
  const width = Math.max(1, Number(entry.width) || catalogPlant?.width || 46), height = Math.max(1, Number(entry.height) || catalogPlant?.height || 70);
  const variant = variantFor(catalogPlant?.variant || entry.variant), seed = entry.seed ?? entry.key ?? entry.node?.dataset.objectId ?? variant;
  const potId = getCatalogPot(entry.potId)?.id ?? catalogPlant?.defaultPotId ?? null;
  const detailed = Boolean(catalogPlant || potId || ['palm','fern','ivy','zz'].includes(variant));
  const random = randomFor(seed), group = new THREE.Group(), content = new THREE.Group();
  content.position.y = -height / 2; group.add(content);
  const textures = new Set(), materials = new Set(), geometries = new Set();
  const mesh = (geometry, material, name) => {
    geometries.add(geometry); materials.add(material);
    const object = new THREE.Mesh(geometry, material); object.name = name;
    object.castShadow = true; object.receiveShadow = true; content.add(object); return object;
  };
  const potHeight = height * (variant === 'succulent' ? .44 : variant === 'ivy' || variant === 'fern' ? .34 : .29), radius = width * (variant === 'ivy' || variant === 'fern' || variant === 'palm' ? .22 : .275);
  const clays = ['#a97958', '#b18b6c', '#bcad94', '#826d60'];
  const potColor = { muskot:'#f1f0e9', muskotblomma:'#b87854', akerbar:'#c0c4c2', gradvis:'#cfb7bb' }[potId] ?? clays[Math.floor(random() * clays.length)];
  const potGrain = potId === 'muskot' || potId === 'gradvis' ? .16 : potId === 'akerbar' ? .26 : .55;
  const clayMap = mineralTexture(random, potColor,false,potId ? potGrain : 1), roughMap = mineralTexture(random, '#ffffff', true,potId ? potGrain : 1);
  textures.add(clayMap); textures.add(roughMap);
  const clay = new THREE.MeshPhysicalMaterial({ map:clayMap, roughnessMap:roughMap, bumpMap:roughMap,
    bumpScale:width * (potId === 'akerbar' ? .00025 : potId === 'muskotblomma' ? .003 : .00045),
    roughness:potId === 'akerbar' ? .36 : potId === 'muskot' ? .26 : potId === 'gradvis' ? .46 : .95,
    metalness:potId === 'akerbar' ? .88 : 0, clearcoat:potId === 'muskot' ? .24 : potId === 'gradvis' ? .16 : 0,
    clearcoatRoughness:.32 });
  const profile = [[.71,0],[.76,.025],[.80,.07],[.97,.86],[1.03,.92],[1.055,.96],[1.035,.985],[.99,1],[.945,.975],[.925,.91],[.70,.11],[0,.11],[0,0]]
    .map(([r,y]) => new THREE.Vector2(radius * r, potHeight * y));
  mesh(potId ? detailedPotGeometry(radius,potHeight,potId) : new THREE.LatheGeometry(profile, 24), clay, 'ceramic-pot');
  if (potId === 'muskotblomma') {
    const saucerProfile = [[0,0],[1.13,0],[1.17,.025],[1.19,.075],[1.18,.14],[1.12,.17],[1.09,.12],[1.07,.07],[0,.065]]
      .map(([r,y]) => new THREE.Vector2(radius * r,potHeight * y));
    mesh(new THREE.LatheGeometry(saucerProfile,48),clay,'terracotta-saucer');
  }
  if (potId === 'akerbar') {
    const seam = mesh(new THREE.CylinderGeometry(width*.0015,width*.0015,potHeight*.87,5),clay,'steel-folded-seam');
    seam.position.set(0,potHeight*.48,-radius*.878); seam.rotation.x = -.16;
  }
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
  const veinMaterial = new THREE.MeshStandardMaterial({ color:'#a0ad70', roughness:.83 });
  const leafMap = detailed ? botanicalTexture(random,variant) : null;
  if (leafMap) textures.add(leafMap);
  const leafMaterial = new THREE.MeshPhysicalMaterial({ map:leafMap, color:0xffffff, vertexColors:true,
    side:THREE.DoubleSide, alphaTest:0, alphaToCoverage:false,
    roughness:variant === 'zz' ? .38 : variant === 'succulent' ? .57 : .70, metalness:0,
    clearcoat:variant === 'zz' ? .28 : variant === 'succulent' ? .18 : .075, clearcoatRoughness:.48 });
  const tube = (points, r, material, name, segments = 6) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, r, 4, false), material, name);
  const blade = (position, direction, length, leafWidth, angle, curve, twist, index) => {
    const parameters = { length, width:leafWidth, variant, curve, twist, random, detailed };
    const geometry = variant === 'ivy' ? ivyLeafGeometry(length,leafWidth,curve,random)
      : catalogPlant && variant === 'monstera' ? monsteraLeafGeometry(length,leafWidth,curve,random) : leafGeometry(parameters);
    const leaf = mesh(geometry, leafMaterial, `leaf-${index}`);
    leaf.position.copy(position);
    leaf.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
    leaf.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, angle));
    const points = [0,.20,.43,.67,.90].map(f => bladePoint(f, 0, length, leafWidth, variant, curve, twist).applyQuaternion(leaf.quaternion).add(position));
    if (!['palm','fern','zz'].includes(variant) && !(catalogPlant && variant === 'succulent')) tube(points, width * .0015, veinMaterial, `leaf-vein-${index}`);
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
      blade(position, direction, height * (i === 0 ? .74 : .50 + random() * .21), width * (catalogPlant ? .25 + random()*.065 : .24 + random() * .055), catalogPlant ? (i%3-1)*.38 : angle * .38,
        .035 + random() * .03, (random() - .5) * .22, i);
    }
  } else if (variant === 'succulent') {
    const count = catalogPlant ? 27 : 9;
    for (let i = 0; i < count; i++) {
      const tier = catalogPlant ? (i < 12 ? 0 : i < 21 ? 1 : 2) : 0;
      const angle = i * 2.39996, ring = catalogPlant ? [.88,.63,.28][tier] : i < 5 ? .55 : .22;
      const direction = new THREE.Vector3(Math.cos(angle) * ring,catalogPlant ? [.34,.58,.92][tier] : .65 + (i % 3) * .10,Math.sin(angle) * ring);
      blade(new THREE.Vector3(Math.cos(angle)*width*.025,soilY + (catalogPlant ? tier*height*.055 : 0),Math.sin(angle)*width*.025), direction,
        height * (catalogPlant ? [.37,.31,.23][tier] : i < 5 ? .58 : .51),width * (catalogPlant ? [.26,.22,.16][tier] : .22 + random()*.035),
        angle,catalogPlant ? .16 : .09,(random()-.5)*.16,i);
    }
  } else if (variant === 'palm' || variant === 'fern') {
    const isPalm = variant === 'palm', fronds = isPalm ? 8 : 10, pairs = 9;
    let index = 0;
    for (let i = 0; i < fronds; i++) {
      const angle = i * 2.39996 + random() * .25;
      const radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const lateral = new THREE.Vector3(-radial.z,0,radial.x);
      const root = radial.clone().multiplyScalar(width * .035); root.y = soilY;
      const reach = width * (isPalm ? .34 : .40) * (.72 + random() * .28);
      const apex = height * (isPalm ? .27 + (i % 4)*.105 + random()*.04 : .25 + (i % 4)*.063 + random()*.04);
      const curve = new THREE.CatmullRomCurve3([
        root,
        root.clone().add(radial.clone().multiplyScalar(reach*.16)).add(new THREE.Vector3(0,apex*.61,0)),
        root.clone().add(radial.clone().multiplyScalar(reach*.57)).add(new THREE.Vector3(0,apex,0)),
        root.clone().add(radial.clone().multiplyScalar(reach)).add(new THREE.Vector3(0,apex*(isPalm ? .59 : .40),0)),
      ]);
      mesh(new THREE.TubeGeometry(curve,12,width*(isPalm ? .0038 : .0046),5,false),stemMaterial,`${isPalm ? 'palm' : 'fern'}-rachis-${i}`);
      for (let p = 0; p < pairs; p++) {
        const f = (isPalm ? .21 : .075) + p / (pairs-1) * (isPalm ? .71 : .85);
        const at = curve.getPoint(f), taper = Math.pow(Math.sin((.14 + p / (pairs-1)*.79)*Math.PI),.60);
        for (const side of [-1,1]) {
          const direction = lateral.clone().multiplyScalar(side*.74).add(radial.clone().multiplyScalar(.38));
          direction.y = isPalm ? -.17 - p / pairs * .27 : -.04 - p / pairs * .19;
          blade(at,direction,height * (isPalm ? .225 : .15) * taper,width * (isPalm ? .030 : .036) * taper,
            side*.18,isPalm ? .13 : .065,(random()-.5)*.12,index++);
        }
      }
      const at = curve.getPoint(.90);
      blade(at,curve.getTangent(.92),height*.075,width*(isPalm ? .026 : .03),0,.065,0,index++);
    }
  } else if (variant === 'zz') {
    let index = 0;
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.39996, radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const sideAxis = new THREE.Vector3(-radial.z,0,radial.x);
      const root = radial.clone().multiplyScalar(width*.065); root.y = soilY;
      const length = height * (.49 + random() * .22);
      const endpoint = root.clone().add(radial.clone().multiplyScalar(width*(.08+random()*.12))).add(new THREE.Vector3(0,length,0));
      const curve = new THREE.CatmullRomCurve3([root,root.clone().lerp(endpoint,.50).add(radial.clone().multiplyScalar(-width*.04)),endpoint]);
      mesh(new THREE.TubeGeometry(curve,12,width*.011,6,false),stemMaterial,`zamioculcas-stem-${i}`);
      for (let pair = 0; pair < 5; pair++) for (const side of [-1,1]) {
        const f = .28 + pair*.135, at = curve.getPoint(f);
        const axis = sideAxis.clone().multiplyScalar(side*.66).add(radial.clone().multiplyScalar(.24)).add(new THREE.Vector3(0,.61,0));
        const size = 1 - pair*.07;
        blade(at,axis,height*.17*size,width*.15*size,side*.2,.07,(random()-.5)*.15,index++);
      }
      blade(curve.getPoint(.94),new THREE.Vector3(radial.x*.3,1,radial.z*.3),height*.12,width*.12,0,.05,0,index++);
    }
  } else if (variant === 'ivy') {
    let index = 0;
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.39996, radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const root = radial.clone().multiplyScalar(width*.055); root.y = soilY;
      const trailing = i > 2, apex = height * (trailing ? .32 : .47);
      const endpoint = radial.clone().multiplyScalar(width*(trailing ? .37 : .22));
      endpoint.y = trailing ? height*.15 + random()*height*.09 : soilY + apex*.8;
      const curve = new THREE.CatmullRomCurve3([
        root,
        root.clone().add(radial.clone().multiplyScalar(width*.12)).add(new THREE.Vector3(0,apex*.75,0)),
        radial.clone().multiplyScalar(width*.28).add(new THREE.Vector3(0,soilY + apex,0)),
        endpoint,
      ]);
      mesh(new THREE.TubeGeometry(curve,12,width*.0048,5,false),stemMaterial,`ivy-vine-${i}`);
      for (let j = 0; j < 5; j++) {
        const at = curve.getPoint(.24 + j*.15), yaw = angle + (j % 2 ? .48 : -.42);
        const axis = new THREE.Vector3(Math.cos(yaw)*.52,trailing && j > 2 ? -.70 : .72,Math.sin(yaw)*.42);
        const leafLength = height*(.17+random()*.035);
        blade(at,axis,leafLength,width*(.22+random()*.04),yaw*.15,.065,(random()-.5)*.20,index++);
      }
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
  const parts = consolidateParts(content, mesh, geometries);
  // Fit foliage, rim and stems to the promised shelf collision envelope.
  // The ceramic base remains exactly at -height/2 when dimensions vary.
  const bounds = new THREE.Box3().setFromObject(content), size = new THREE.Vector3(); bounds.getSize(size);
  const xExtent = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  const zExtent = Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z));
  content.scale.set(Math.min(1, width / 2 / xExtent), height / (bounds.max.y + height / 2), Math.min(1, width * .35 / zExtent));
  group.userData.variant = variant; group.userData.seed = String(seed);
  group.userData.catalogId = catalogPlant?.id ?? null; group.userData.potId = potId;
  group.userData.parts = parts;
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
