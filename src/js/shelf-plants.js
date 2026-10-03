import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getCatalogPot, getPotColor } from './plant-catalog-data.js';
import { resolveCatalogPlant } from './plant-records.js';
import { plantDimensions, POT_SOIL_FRACTION } from './plant-dimensions.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const srgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

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

// Deterministic lattice noise. The x axis may wrap so fields tile seamlessly
// around a lathe; nothing here depends on Math.random or on the DOM.
function hash(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
const wrap = (value, period) => period ? (value % period + period) % period : value;
function noise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), x0 = wrap(xi, period), x1 = wrap(xi + 1, period);
  const a = hash(x0, yi, seed), b = hash(x1, yi, seed), c = hash(x0, yi + 1, seed), d = hash(x1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, period, seed, octaves = 3) {
  let sum = 0, amplitude = .5, total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const scale = 2 ** octave;
    sum += amplitude * noise(x * scale, y * scale, period * scale, seed + octave * 31);
    total += amplitude; amplitude *= .5;
  }
  return sum / total;
}
const cell = { f1:0, f2:0, id:0, dx:0, dy:0 };
function voronoi(x, y, period, seed) {
  // One hash per cell supplies its jitter and identity; dx/dy point from the
  // sample to the nearest feature, so a grain can be shaded across its face.
  const xi = Math.floor(x), yi = Math.floor(y); let f1 = 9, f2 = 9, id = 0, nx = 0, ny = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cy = yi + j, h = hash(wrap(xi + i, period), cy, seed);
    const dx = xi + i + h - x, dy = cy + h * 4099 % 1 - y, d = dx * dx + dy * dy;
    if (d < f1) { f2 = f1; f1 = d; id = h * 65537 % 1; nx = dx; ny = dy; } else if (d < f2) f2 = d;
  }
  cell.f1 = Math.sqrt(f1); cell.f2 = Math.sqrt(f2); cell.id = id; cell.dx = nx; cell.dy = ny;
  return cell;
}

function dataTexture(bytes, width, height, colorSpace, repeat) {
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.colorSpace = colorSpace; texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  if (repeat) texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true; return texture;
}

// Full-resolution painting runs in idle slices, so the first plant of a kind
// never blocks the frame that shows it; a coarse preview stands in meanwhile.
const surfaces = new Map(), queue = [], settled = [], redraws = new Set();
const idle = callback => typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout:200 })
  : setTimeout(() => callback({ timeRemaining:() => 0 }), 16);
const PREVIEW = 8;

function pump(deadline) {
  // Use the idle period the browser offers (a forced, timed-out slice stays
  // short). Bounded by rows as well, so a frozen clock cannot stall the loop.
  const until = performance.now() + Math.min(16, Math.max(5, deadline.timeRemaining() - 1));
  for (let chunk = 0; queue.length && chunk < 48 && (chunk === 0 || performance.now() < until); chunk++) {
    const job = queue[0];
    for (const end = Math.min(job.height, job.row + 4); job.row < end; job.row++)
      for (let x = 0; x < job.width; x++) job.store(job.row * job.width + x, job.sample(x, job.row));
    if (job.row < job.height) continue;
    queue.shift();
    const { base } = job;
    // One new Source version re-uploads the shared image once; every live
    // clone just needs its own version bumped to look at it again.
    base.map.source.needsUpdate = base.data.source.needsUpdate = true;
    for (const texture of base.clones) texture.version++;
    for (const refresh of base.waiting) redraws.add(refresh);
    base.clones = base.waiting = null;
  }
  if (queue.length) { idle(pump); return; }
  // One redraw per waiting plant once everything is in, not one per surface.
  for (const refresh of redraws) refresh();
  redraws.clear();
  for (const resolve of settled.splice(0)) resolve();
}

/** Resolves once every procedural plant surface has its final detail. */
export const plantSurfacesReady = () => queue.length ? new Promise(resolve => settled.push(resolve)) : Promise.resolve();

/** Paint an sRGB pigment map and one linear data map (R relief for bumpMap,
 * G roughness for roughnessMap) once per surface kind. Every model owns cheap
 * clones: they share the Source, so identical pots share one GPU upload that
 * is released when the last clone is disposed. */
function surface(key, [width, height], repeat, paint, refresh) {
  let base = surfaces.get(key);
  if (!base) {
    const pigment = new Uint8Array(width * height * 4), data = new Uint8Array(pigment.length), texel = [0, 0, 0, .5, 1];
    const sample = (x, y) => { paint((x + .5) / width, (y + .5) / height, x, y, texel); return texel; };
    const store = (index, value) => {
      const i = index * 4;
      for (let c = 0; c < 3; c++) pigment[i + c] = Math.round(255 * clamp01(value[c]));
      data[i] = Math.round(255 * clamp01(value[3])); data[i + 1] = Math.round(255 * clamp01(value[4]));
      pigment[i + 3] = data[i + 3] = 255;
    };
    // Coarse preview: the same painter on an 8px lattice, spread bilinearly
    // (and wrapped around a lathe), at about 1/64 of the full cost.
    const columns = Math.ceil(width / PREVIEW) + 1, rows = Math.ceil(height / PREVIEW) + 1, lattice = new Float32Array(columns * rows * 5);
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
      const x = i * PREVIEW >= width ? repeat ? 0 : width - 1 : i * PREVIEW;
      lattice.set(sample(x, Math.min(height - 1, j * PREVIEW)), (j * columns + i) * 5);
    }
    const mixed = [0, 0, 0, 0, 0];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = Math.min(columns - 2, Math.floor(x / PREVIEW)), j = Math.min(rows - 2, Math.floor(y / PREVIEW));
      const fx = Math.min(1, (x - i * PREVIEW) / PREVIEW), fy = Math.min(1, (y - j * PREVIEW) / PREVIEW);
      const a = (j * columns + i) * 5, b = a + 5, c = a + columns * 5, d = c + 5;
      for (let k = 0; k < 5; k++) {
        const top = lattice[a + k] + (lattice[b + k] - lattice[a + k]) * fx, bottom = lattice[c + k] + (lattice[d + k] - lattice[c + k]) * fx;
        mixed[k] = top + (bottom - top) * fy;
      }
      store(y * width + x, mixed);
    }
    base = { map:dataTexture(pigment, width, height, THREE.SRGBColorSpace, repeat), data:dataTexture(data, width, height, THREE.NoColorSpace, repeat),
      clones:[], waiting:[] };
    surfaces.set(key, base);
    queue.push({ base, width, height, row:0, sample, store });
    if (queue.length === 1) idle(pump);
  }
  // Texture.copy() raises the shared Source's version, which would re-upload
  // the image for every clone; keep it, so identical surfaces share one upload.
  const clone = texture => {
    const version = texture.source.version, copy = texture.clone();
    copy.source.version = version; base.clones?.push(copy); return copy;
  };
  if (refresh) base.waiting?.push(refresh);
  return { map:clone(base.map), data:clone(base.data) };
}

// Sansevieria blades sample one of four narrow strips (32 x 256 texels each):
// the texel density then matches a sword leaf, so the mip chosen for a blade
// only a few pixels wide still resolves its cross bands along the length.
const SNAKE_STRIPS = 4, SNAKE_INSET = .04;

function sansevieriaTextures(refresh, quality = 1) {
  const deep = srgb('#1d3621'), leaf = srgb('#2f5230'), sage = srgb('#96a88c'), gold = srgb('#b6a85c');
  return surface(`leaf:upright:${quality}`, [SNAKE_STRIPS * 32 * quality, 256 * quality], false, (u, v, x, y, texel) => {
    const strip = Math.min(SNAKE_STRIPS - 1, Math.floor(u * SNAKE_STRIPS)), s = u * SNAKE_STRIPS - strip;
    const a = Math.abs(s * 2 - 1), seed = 71 + strip * 13;
    // Irregular pale cross bands, about a dozen per blade: shallow chevrons
    // dipping toward the margins, warped, with a jagged edge, a width and a
    // strength of their own, broken into dashes; they fade toward the tip.
    const warp = fbm(s * 2, v * 7, 0, seed, 2) - .5, zig = Math.abs((s * 5 + noise(s * 3, v * 40, 0, seed + 4) * .8) % 1 - .5);
    const phase = v * 12 + strip * .37 - a * a * .55 + warp * 1.5 + zig * .3;
    const k = Math.floor(phase), p = phase - k, span = .22 + hash(k, strip, seed) * .3;
    const band = smoothstep(0, .07, p) * (1 - smoothstep(span, span + .07, p)) * (.5 + .5 * hash(k, strip, seed + 5));
    // A fainter, finer ripple fills the dark ground between the bands.
    const ripple = Math.pow(Math.max(0, Math.sin((phase * 2.6 + warp) * Math.PI * 2)), 6) * .28;
    const broken = smoothstep(.2, .55, noise(s * 5, v * 70, 0, seed + 1));
    const pale = Math.max(band * (.35 + .65 * broken), ripple * broken) * (1 - smoothstep(.84, 1, v)), speck = hash(x, y, seed + 2) - .5;
    const field = fbm(s * 3, v * 16, 0, seed + 3, 2);
    // Golden 'Laurentii' margins, with a thin darker seam against the blade.
    const margin = smoothstep(.82, .87, a), seam = Math.exp(-(((a - .81) / .025) ** 2)) * .3;
    for (let c = 0; c < 3; c++) {
      const green = (deep[c] + (leaf[c] - deep[c]) * field) * (1 + speck * .06), banded = (green + (sage[c] - green) * pale * .8) * (1 - seam);
      texel[c] = banded + (gold[c] * (.94 + speck * .1) - banded) * margin;
    }
    texel[3] = .46 + pale * .06 - margin * .03 + speck * .03;
    texel[4] = .6 + pale * .06 + speck * .05;
  }, refresh);
}

function botanicalTextures(variant, refresh, quality = 1) {
  if (variant === 'upright') return sansevieriaTextures(refresh, quality);
  // A single surface field drives pigment, relief and wax roughness together.
  const base = srgb({ zz:'#2f5324', fern:'#4a7a2c', succulent:'#6a8a80', ivy:'#2a4c23', palm:'#3d6c2a', monstera:'#2f6128' }[variant] ?? '#36672c');
  const phase = hash(variant.length, 3, 11) * Math.PI * 2, seed = variant.charCodeAt(0);
  return surface(`leaf:${variant}:${quality}`, [128 * quality, 128 * quality], false, (u, v, x, y, texel) => {
    const signed = u * 2 - 1, a = Math.abs(signed);
    const midrib = Math.exp(-a * 48);
    // Branch veins sweep toward the tip, with finer tertiary venation.
    const veinPhase = (v * 9 - a * .95 + .06 * Math.sin(a * 5) + signed * .09) * Math.PI * 2;
    let lateral = Math.pow(Math.max(0, Math.cos(veinPhase)), 24) * (1 - a);
    const fine = Math.pow(Math.max(0, Math.cos((v * 37 + a * 12) * Math.PI * 2)), 18) * a * (1 - a);
    if (variant === 'ivy') {
      // Hedera is palmately veined: pale rays fan out from the petiole.
      const angle = Math.atan2(signed * .5, v), reach = Math.hypot(signed * .5, v);
      lateral = Math.pow(Math.max(0, Math.cos(angle * 11.4)), 46) * smoothstep(.95, .1, reach) * 2.2;
    }
    const cells = (hash(x, y, seed) - .5) * .025;
    const mottling = Math.sin(v * 19 + Math.sin(signed * 11 + phase)) * Math.cos(signed * 17 - v * 7) * .027;
    const margin = variant === 'ivy' ? Math.pow(a, 5) * .06 : 0;
    const bloom = variant === 'succulent' ? fbm(u * 6, v * 6, 0, seed + 4) * .05 : 0;
    const veins = (midrib * .055 + lateral * .035 + fine * .012) * (variant === 'succulent' ? .12 : variant === 'ivy' ? 1.6 : 1);
    const variation = cells + mottling + margin + veins + bloom;
    texel[0] = base[0] + variation;
    texel[1] = base[1] + variation;
    texel[2] = base[2] + variation * .65 + bloom * .6;
    texel[3] = .38 + midrib * .30 + lateral * .16 + fine * .06 + cells;
    texel[4] = .62 + veins * 2 + mottling * 3 + cells;
  }, refresh);
}

// Texture rows along a pot's profile: foot ring, outer wall, lip, visible
// inner wall, then everything hidden below the soil.
const FOOT = .07, RIM = .6, SOIL = .74;

// Rows below the soil line are never visible.
const hidden = (v, texel) => {
  if (v < SOIL + .03) return false;
  texel[0] = texel[1] = texel[2] = .2; texel[3] = .5; texel[4] = 1; return true;
};

function glazedPainter({ glaze, body, gloss, speckle, crackle, seed }) {
  const G = srgb(glaze), B = srgb(body), iron = [.34, .45, .6], edges = [];
  return (u, v, x, y, texel) => {
    if (hidden(v, texel)) return;
    const cloud = fbm(u * 5, v * 5, 5, seed, 2);
    // A dipped glaze stops above the foot with an uneven edge and short runs.
    const edge = edges[x] ??= FOOT + (noise(u * 18, 0, 18, seed + 4) - .5) * .018 - Math.max(0, noise(u * 36, 0, 36, seed + 3) - .7) * .1;
    const glazed = smoothstep(edge - .004, edge + .004, v), bead = Math.exp(-(((v - edge) / .006) ** 2));
    const lip = Math.exp(-(((v - RIM) / .012) ** 2)) * .24;
    const speck = hash(x, y, seed + 5) > 1 - speckle ? .4 + hash(x, y, seed + 6) * .4 : 0;
    let crack = 0;
    if (crackle && v > edge) { const c = voronoi(u * 12, v * 17, 12, seed + 7); crack = (1 - smoothstep(0, .03, c.f2 - c.f1)) * crackle; }
    const grain = hash(x, y, seed + 8) - .5, cover = glazed * (1 - lip);
    for (let c = 0; c < 3; c++) {
      const glazeTone = G[c] * (.975 + cloud * .045) * (1 - crack * .06) * (1 - speck * iron[c] * glazed);
      const bodyTone = B[c] * (.92 + grain * .14);
      texel[c] = bodyTone + (glazeTone - bodyTone) * cover;
    }
    texel[3] = .5 + glazed * (cloud * .06 - speck * .22 - crack * .1) + (1 - glazed) * grain * .35 + bead * .14;
    texel[4] = .84 + grain * .1 + (gloss + cloud * .06 + crack * .1 + speck * .2 - .84 - grain * .1) * glazed;
  };
}

function terracottaPainter(hex, seed) {
  const C = srgb(hex), salt = srgb('#e3dccf'), wheel = [];
  return (u, v, x, y, texel) => {
    if (hidden(v, texel)) return;
    // Broad firing clouds, then a warped sandy field: no lattice shows through.
    const mottle = fbm(u * 3, v * 5, 3, seed, 2), warp = fbm(u * 5, v * 9, 5, seed + 9, 2);
    const fine = fbm(u * 14 + warp * 1.6, v * 26 + warp * 2, 14, seed + 1, 2), sand = hash(x, y, seed + 2) - .5;
    // Open pores and grog: small irregular pits, a few pale or dark grains.
    const pit = voronoi(u * 26, v * 52, 26, seed + 6), pore = pit.id > .84 ? smoothstep(.26, .08, pit.f1 + (fine - .5) * .15) : 0;
    const grog = pit.id < .03 ? smoothstep(.22, .08, pit.f1) * (pit.id < .012 ? -1 : 1) : 0;
    // Efflorescence gathers where water evaporates: under the collar and at the foot.
    const where = Math.max(Math.exp(-(((v - RIM + .06) / .09) ** 2)), Math.exp(-(((v - .02) / .06) ** 2)) * .85);
    const bloom = where > .02 ? smoothstep(.5, .8, fbm(u * 7, v * 10 + warp, 7, seed + 3)) * where * .3 : 0;
    // Faint throwing rings a few millimetres apart, wandering round the pot.
    const throwing = Math.sin(v * 120 + (wheel[x] ??= noise(u * 6, 0, 6, seed + 5) * 4)) * .008;
    const inner = v > RIM + .012 ? .8 : 1;
    const tone = (.87 + mottle * .2 + (fine - .5) * .1 + sand * .045 + throwing - pore * .06 + grog * .08) * inner;
    const warmth = [1 + (mottle - .5) * .08, 1, 1 - (mottle - .5) * .06];
    for (let c = 0; c < 3; c++) { const clay = C[c] * tone * warmth[c]; texel[c] = clay + (salt[c] - clay) * bloom; }
    texel[3] = .5 + (fine - .5) * .22 + sand * .1 - pore * .2 + grog * .1 + throwing * 2 + bloom * .1;
    texel[4] = .9 + (fine - .5) * .08 + pore * .06 + bloom * .06;
  };
}

function galvanizedPainter(seed, hex = '#cfd3d5') {
  const zinc = srgb(hex);
  return (u, v, x, y, texel) => {
    if (hidden(v, texel)) return;
    // Hot-dip spangle: flakes about a centimetre across, each tilted its own
    // way with fine dendrite ripples, so some catch the light and some stay
    // frosted instead of reading as flat grey patches.
    const c = voronoi(u * 12, v * 24, 12, seed), id = c.id, border = smoothstep(0, .05, c.f2 - c.f1);
    const angle = id * Math.PI * 2, ax = Math.cos(angle), ay = Math.sin(angle), tilt = c.dx * ax + c.dy * ay;
    const feather = Math.sin((u * 12 * ax + v * 24 * ay) * 11 + id * 40 + noise(u * 40, v * 80, 40, seed + 1) * 2.5) * .5 + .5;
    const bead = v < FOOT + .015 || Math.abs(v - RIM) < .035 ? .93 : 1, inner = v > RIM + .035 ? .9 : 1;
    const tone = (.95 + (id - .5) * .035 + tilt * .015 + feather * .012) * (.98 + border * .02) * bead * inner;
    for (let k = 0; k < 3; k++) texel[k] = zinc[k] * tone;
    texel[3] = .5 + tilt * .035 + feather * .02 - (1 - border) * .04;
    texel[4] = .34 + id * .12 + feather * .04 + (1 - border) * .04 + (1 - bead) * .25;
  };
}

const POT_FINISHES = {
  // Glossy white earthenware with faint crazing and iron specks.
  muskot:{ painter:color => glazedPainter({ glaze:color, body:'#cfbea3', gloss:.24, speckle:.0022, crackle:.55, seed:17 }),
    material:{ clearcoat:.42, clearcoatRoughness:.16, bumpScale:.55 } },
  // Satin pink stoneware, freckled by the clay body.
  gradvis:{ painter:color => glazedPainter({ glaze:color, body:'#c7a291', gloss:.42, speckle:.004, crackle:0, seed:29 }),
    material:{ clearcoat:.2, clearcoatRoughness:.42, bumpScale:.45 } },
  akerbar:{ painter:color => galvanizedPainter(41,color), material:{ metalness:.85, bumpScale:.3 } },
};

function potProfile(potId) {
  if (potId === 'muskot') {
    // Broad lower horizontal bands, as on the real white MUSKOT.
    const profile = [[.76,0],[.80,.025]];
    for (let i = 0; i <= 20; i++) {
      const y = .04 + i / 20 * .54;
      profile.push([.81 + y * .20 + .019 * Math.sin(i * Math.PI / 2), y]);
    }
    return [...profile, [.975,.90],[.994,.955],[.998,.984],[.986,.999],[.963,.998],[.949,.979],[.936,.94],[.922,.84],[0,.84]];
  }
  if (potId === 'gradvis') return [[.53,0],[.64,.025],[.76,.08],[.86,.16],[.93,.27],[.97,.39],[.99,.54],[1,.95],[.997,.985],[.982,1],[.955,.998],[.942,.975],[.935,.84],[0,.84]];
  if (potId === 'akerbar') return [[.78,0],[.81,.015],[.81,.035],[.785,.048],[.79,.085],[.97,.95],[1,.971],[1.018,.99],[1,1.011],[.98,1.014],[.96,1],[.957,.983],[.955,.95],[.948,.84],[0,.84]];
  // Terracotta: tapered body under a thick, rounded collar.
  return [[.68,0],[.715,.012],[.735,.05],[.895,.785],[.93,.80],[.985,.815],[1.005,.84],[1.012,.90],[1.008,.965],[.992,.992],[.965,1],[.935,.994],[.918,.965],[.912,.9],[.905,.84],[0,.84]];
}

function potGeometry(potId, radius, height, soilFraction) {
  const rawProfile = potProfile(potId), fullHeight = Math.max(...rawProfile.map(([,y]) => y));
  const profile = rawProfile.map(([r,y]) => [r,y/fullHeight]), n = profile.length, fluted = potId === 'gradvis';
  // `radius` is the pot's real outer radius: its widest point (a rolled rim, or
  // the crest of a rib) reaches exactly that, whatever the profile's own units.
  radius /= Math.max(...profile.map(([r]) => r)) + (fluted ? .018 : 0);
  const segments = fluted ? 96 : potId === 'muskot' ? 40 : 48;
  const geometry = new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r * radius, y * height)), segments);
  const s = [0];
  for (let j = 1; j < n; j++) s.push(s[j - 1] + Math.hypot((profile[j][0] - profile[j - 1][0]) * radius, (profile[j][1] - profile[j - 1][1]) * height));
  let top = 0;
  for (let j = 1; j < n; j++) if (profile[j][1] > profile[top][1]) top = j;
  const cross = (start, end, y) => {
    for (let j = start; j < end; j++) {
      const [ra, ya] = profile[j], [rb, yb] = profile[j + 1];
      if (ya !== yb && (ya - y) * (yb - y) <= 0) { const t = (y - ya) / (yb - ya); return { s:s[j] + (s[j + 1] - s[j]) * t, r:ra + (rb - ra) * t }; }
    }
    return { s:s[end], r:profile[end][0] };
  };
  // Arc length anchors keep the unglazed foot, lip and soil line in the same
  // texture rows whatever the pot's proportions.
  const foot = cross(0, top, .04), soil = cross(top, n - 1, soilFraction);
  const anchors = [[0,0],[foot.s,FOOT],[s[top],RIM],[soil.s,SOIL],[s[n - 1],1]];
  const rowFor = value => {
    for (let k = 1; k < anchors.length; k++) if (value <= anchors[k][0] || k === anchors.length - 1) {
      const [s0,v0] = anchors[k - 1], [s1,v1] = anchors[k];
      return v0 + (v1 - v0) * (s1 > s0 ? clamp01((value - s0) / (s1 - s0)) : 0);
    }
    return 1;
  };
  const uv = geometry.attributes.uv, position = geometry.attributes.position, colors = new Float32Array(position.count * 3).fill(1);
  const lip = profile[top][1];
  for (let i = 0; i <= segments; i++) for (let j = 0; j < n; j++) {
    const index = i * n + j, [r, y] = profile[j];
    uv.setY(index, rowFor(s[j]));
    let tone = 1;
    // The inside of the pot falls into shadow towards the soil.
    if (j > top) tone = y < soilFraction - .01 ? .42 : 1 - .45 * smoothstep(0, 1, (lip - y) / (lip - soilFraction));
    else if (potId === 'muskot' && j > 0 && j < top) tone += THREE.MathUtils.clamp((r - (profile[j - 1][0] + profile[j + 1][0]) / 2) * 5, -.09, .02);
    if (fluted && j < top) {
      const x = position.getX(index), z = position.getZ(index), px = Math.hypot(x, z), rib = -Math.cos(Math.atan2(x, z) * 32);
      // Rounded vertical ribs fade into the foot and stop below the rim.
      const fade = Math.sin(Math.min(1, y * 7) * Math.PI / 2) * THREE.MathUtils.clamp((.97 - y) * 14, 0, 1);
      const offset = rib * radius * .018 * fade;
      if (px) position.setXYZ(index, x / px * (px + offset), position.getY(index), z / px * (px + offset));
      tone *= 1 + Math.min(0, rib) * .07 * fade;
    }
    colors[index * 3] = colors[index * 3 + 1] = colors[index * 3 + 2] = tone;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (fluted) {
    geometry.computeVertexNormals();
    // Weld the lathe seam so the first rib is not shaded as a hard edge.
    const normal = geometry.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      a.fromBufferAttribute(normal, j).add(b.fromBufferAttribute(normal, segments * n + j)).normalize();
      normal.setXYZ(j, a.x, a.y, a.z); normal.setXYZ(segments * n + j, a.x, a.y, a.z);
    }
  }
  return { geometry, soilRadius:soil.r * radius, radius };
}

function soilPainter(kind) {
  const peat = srgb('#3b2b1f'), bark = srgb('#5e3d29'), perlite = srgb('#d9d6cc'), damp = srgb('#271c14');
  const stones = ['#a39c90','#bdb099','#7e6c5b','#d8d4cb','#8f8a82'].map(srgb);
  return (u, v, x, y, texel) => {
    const grain = hash(x, y, 7);
    if (Math.hypot(u - .5, v - .5) > .54) {
      // Neutral corner, only sampled by pebbles, bark chips and perlite.
      texel[0] = texel[1] = texel[2] = .8 + grain * .14; texel[3] = .45 + grain * .2; texel[4] = .82; return;
    }
    if (kind === 'grit') {
      const c = voronoi(u * 26, v * 26, 0, 3), gap = 1 - smoothstep(.02, .1, c.f2 - c.f1), dome = 1 - Math.min(1, c.f1 * 1.5);
      const stone = stones[Math.floor(c.id * stones.length)], tone = .74 + dome * .32 + (grain - .5) * .08;
      for (let k = 0; k < 3; k++) texel[k] = stone[k] * tone + (damp[k] - stone[k] * tone) * gap;
      texel[3] = .25 + dome * .55 - gap * .2; texel[4] = .76 + gap * .18; return;
    }
    const clump = fbm(u * 9, v * 9, 0, 11), crumbs = fbm(u * 34, v * 34, 0, 12, 2), wet = smoothstep(.4, .72, fbm(u * 3, v * 3, 0, 13, 2));
    // Sparse rounded perlite grains and a few bark flakes, soft edged and
    // warped by the crumb field so they never read as square confetti.
    const grit = voronoi(u * 22, v * 22, 0, 17), speck = grit.id > .93 ? smoothstep(.3, .14, grit.f1 + (crumbs - .5) * .12) : 0;
    const chip = voronoi(u * 11, v * 11, 0, 19), woody = chip.id > .86 ? smoothstep(.36, .24, chip.f1 * (1 + (clump - .5) * .8)) * (1 - speck) : 0;
    const tone = .66 + clump * .5 + (crumbs - .5) * .55 + (grain - .5) * .16 - wet * .18;
    for (let k = 0; k < 3; k++) {
      const soil = peat[k] * tone, wood = bark[k] * (.75 + crumbs * .35);
      texel[k] = soil + (wood - soil) * woody + (perlite[k] * (.84 + grain * .12) - soil) * speck;
    }
    texel[3] = .3 + clump * .3 + (crumbs - .5) * .4 + (grain - .5) * .12 + speck * .3 + woody * .16;
    texel[4] = .97 - wet * .12 - speck * .1 - woody * .05;
  };
}

function soilGeometry(radius, y, random, roots, kind) {
  // A shallow mound meets the pot wall in a darker moist edge; stems sink into
  // soft shadowed collars. Pebbles, bark and perlite join the same draw.
  const segments = 32, rings = 6, positions = [0, y + radius * .035, 0], uv = [.5, .5], indices = [];
  for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2, f = ring / rings;
    const lift = ring === rings ? radius * .014 : radius * (.035 * (1 - f * f) + (random() - .5) * .028);
    positions.push(Math.cos(angle) * radius * f, y + lift, Math.sin(angle) * radius * f);
    uv.push(.5 + Math.cos(angle) * f / 2, .5 + Math.sin(angle) * f / 2);
  }
  for (let i = 0; i < segments; i++) indices.push(0, 1 + (i + 1) % segments, 1 + i);
  for (let ring = 1; ring < rings; ring++) for (let i = 0; i < segments; i++) {
    const a = 1 + (ring - 1) * segments + i, b = 1 + (ring - 1) * segments + (i + 1) % segments;
    indices.push(a, b, b + segments, a, b + segments, a + segments);
  }
  const colors = [];
  for (let k = 0; k < positions.length; k += 3) {
    const x = positions[k], z = positions[k + 2];
    let tone = 1 - .5 * smoothstep(.72, 1, Math.hypot(x, z) / radius);
    for (const [rx, rz, rr] of roots) tone *= 1 - .38 * Math.exp(-((Math.hypot(x - rx, z - rz) / (rr * 2.4 + radius * .06)) ** 2));
    colors.push(tone, tone, tone);
  }
  const bed = new THREE.BufferGeometry();
  bed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bed.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  bed.setIndex(indices); bed.computeVertexNormals();
  const parts = [bed.toNonIndexed()]; bed.dispose();
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), euler = new THREE.Euler(), colour = new THREE.Color();
  const palette = kind === 'grit' ? ['#a39c90','#c2b59d','#7f6d5c','#dcd8cf'] : null;
  for (let k = 0, pieces = kind === 'grit' ? 12 : 5; k < pieces; k++) {
    const chip = !palette && k < 3, perlite = !palette && !chip;
    const size = radius * (chip ? .085 + random() * .05 : perlite ? .03 + random() * .022 : .055 + random() * .045);
    const piece = new THREE.IcosahedronGeometry(size, 0);
    const angle = random() * Math.PI * 2, r = radius * (.22 + .62 * Math.sqrt(random()));
    euler.set((random() - .5) * .5, random() * Math.PI * 2, (random() - .5) * .5); rotation.setFromEuler(euler);
    matrix.compose(new THREE.Vector3(Math.cos(angle) * r, y + radius * .035 * (1 - (r / radius) ** 2) + size * (chip ? .04 : .12), Math.sin(angle) * r),
      rotation, chip ? new THREE.Vector3(1.5, .3, .9) : new THREE.Vector3(1, .62, .85));
    piece.applyMatrix4(matrix);
    colour.set(palette ? palette[Math.floor(random() * palette.length)] : chip ? '#6b4630' : '#ebe8e0').multiplyScalar(.82 + random() * .3);
    const count = piece.attributes.position.count;
    piece.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length:count }, () => [colour.r, colour.g, colour.b]).flat(), 3));
    piece.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(count * 2).fill(.965), 2));
    parts.push(piece);
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return geometry;
}

function bladePoint(f, u, length, width, variant, curve, twist) {
  const profile = variant === 'upright' ? Math.pow(Math.max(0, 1 - f * f), .68) * (.72 + .28 * Math.sin(f * Math.PI))
    // Echeveria leaves are spatulate: narrow at the base, broad high up, then a short point.
    : variant === 'succulent' ? (f < .74 ? .42 + .58 * Math.sin(f / .74 * Math.PI / 2) : Math.pow(Math.cos((f - .74) / .26 * Math.PI / 2), .55))
    : Math.pow(Math.max(0,Math.sin(Math.PI * Math.pow(f, variant === 'leafy' || variant === 'ivy' ? .56 : .75))), variant === 'zz' ? .45 : .65);
  const lobes = variant === 'monstera' ? 1 - .54 * Math.pow(Math.sin(f * Math.PI * 5), 8)
    : variant === 'ivy' ? .53 + .47 * Math.pow(Math.cos(f * Math.PI * 3.3 - .2),2)
    : variant === 'fern' ? .92 + .08 * Math.cos(f * Math.PI * 14) : 1;
  const asymmetry = 1 + .055 * Math.sin(f * 7 + twist * 4) * Math.sign(u);
  const x = width * .5 * profile * lobes * u * asymmetry;
  const bow = Math.sin(f * Math.PI * .85) * length * curve;
  // Sansevieria swords are channelled: a stiff U that flattens toward the tip.
  const ridge = variant === 'upright' ? width * .15 * (1 - f * .6) * u * u
    : width * (variant === 'succulent' ? .075 : .065) * Math.pow(Math.abs(u), variant === 'succulent' ? 2 : 1.5);
  const edgeCurl = variant === 'succulent' || variant === 'upright' ? 0 : width * .022 * Math.pow(Math.abs(u), 3) * Math.sin(f * 19 + twist * 9) * Math.sin(f * Math.PI);
  const z = bow + ridge + edgeCurl, angle = twist * f;
  return new THREE.Vector3(x * Math.cos(angle) + z * Math.sin(angle), f * length, z * Math.cos(angle) - x * Math.sin(angle));
}

function leafGeometry({ length, width, variant, curve, twist, random, detailed = false }) {
  const rows = variant === 'palm' ? 4 : variant === 'fern' ? 3 : variant === 'zz' ? 6 : variant === 'succulent' && detailed ? 10 : variant === 'ivy' ? 8 : variant === 'upright' ? 16 : variant === 'monstera' ? 14 : 12;
  const columns = variant === 'palm' || variant === 'fern' ? 2 : variant === 'monstera' ? 10 : variant === 'leafy' || variant === 'upright' || (variant === 'succulent' && detailed) ? 6 : 4;
  // Small palm and fern leaflets are single sheets: a lit double-sided sheet
  // reads identically and leaves budget for many more real pinnae.
  const thick = variant === 'succulent' || (detailed && variant !== 'palm' && variant !== 'fern');
  const thickness = thick ? width * (variant === 'succulent' ? (detailed ? .15 : .07) : .008) : 0;
  const positions = [], colors = [], uv = [], indices = [];
  const inset = .012;
  // Each leaf has its own age: new growth is lighter and yellower, older
  // leaves darker and bluer.
  const tint = random() * .08, hue = (random() - .5) * .1, strip = Math.min(SNAKE_STRIPS - 1, Math.floor(tint / .08 * SNAKE_STRIPS));
  for (let side = 0; side <= Number(thick); side++) for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const f = row / rows, u = col / columns * 2 - 1;
    const point = bladePoint(f, u, length, width, variant, curve, twist);
    const flesh = variant === 'succulent' ? thickness * Math.pow(Math.sin(f * Math.PI), .65) * Math.sqrt(Math.max(0, 1 - u*u)) * (1.25 - f * .45) : thickness;
    positions.push(point.x, point.y, point.z + (variant === 'succulent' ? (side ? -1 : 1) * flesh : -side * flesh));
    uv.push(variant === 'upright' ? (strip + SNAKE_INSET + col / columns * (1 - SNAKE_INSET * 2)) / SNAKE_STRIPS : inset + col / columns * (1 - inset * 2), inset + f * (1 - inset * 2));
    const edge = Math.pow(Math.abs(u), 2), ridge = 1 - Math.abs(u);
    // Echeveria tips blush pink where the wax is thinnest.
    const blush = variant === 'succulent' ? smoothstep(.78, 1, f) * (.6 + edge * .4) : 0;
    if (detailed) colors.push(.78 + ridge * .12 + tint + side * .04 + hue * .8 + blush * .34, .85 + ridge * .10 + tint + side * .025 + hue * .15 - blush * .12,
      .73 + ridge * .12 + tint + side * .055 - hue * .5 + blush * .04);
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
  // Five broad lobes with shallow sinuses and a notched, cordate base form the
  // real silhouette rather than an alpha card. A centre fan and one middle
  // ring cup the thin blade; it is a single double-sided sheet, which reads
  // the same on the shelf and leaves budget for a much fuller plant.
  const outline = [[0,.05],[-.14,-.01],[-.30,.10],[-.50,.30],[-.37,.43],[-.45,.63],[-.19,.66],[0,1],[.19,.66],[.45,.63],[.37,.43],[.50,.30],[.30,.10],[.14,-.01]];
  const positions = [], uv = [], colors = [], indices = [], segments = outline.length;
  const center = new THREE.Vector3(0,length*.44,length*curve*.75), tint = random()*.045, asymmetry = (random()-.5)*.12, hue = (random()-.5)*.08;
  const vertex = (x, y, f) => {
    const px = x*width*f*(1+asymmetry*Math.sign(x)), py = center.y + (y*length-center.y)*f;
    positions.push(px,py,center.z + Math.abs(x)*width*.055*f + Math.sin(y*Math.PI)*length*curve*.2*f);
    uv.push(.5+px/width,Math.max(0,py/length)); colors.push(.86+tint+hue*.8,.92+tint+hue*.15,.83+tint-hue*.5);
  };
  vertex(0, .44, 0);
  for (const f of [.5, 1]) for (const [x,y] of outline) vertex(x, y, f);
  for (let j = 0; j < segments; j++) {
    const next = (j+1)%segments, a = 1+j, b = 1+next, c = a+segments, d = b+segments;
    indices.push(0,b,a, a,b,d, a,d,c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function subdivideSurface(surface) {
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
  const surface = subdivideSurface(new THREE.ShapeGeometry(shape,5)), source = surface.attributes.position, count = source.count;
  const positions = [], uv = [], colors = [], indices = [], edges = new Map(), tint = random()*.035, twist = (random()-.5)*.16, hue = (random()-.5)*.07;
  for (let side = 0; side < 2; side++) for (let i = 0; i < count; i++) {
    const x = source.getX(i), y = source.getY(i);
    positions.push(x*width*(1+twist*Math.sign(x)),(y-.12)*length,Math.sin(y*Math.PI)*length*curve + x*x*width*.15 + x*width*twist*y - side*width*.009);
    uv.push(.5+x,y); colors.push(.85+tint+side*.04+hue*.8,.93+tint+side*.025+hue*.15,.81+tint+side*.055-hue*.5);
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
  const positions = [], colors = [], uv = [], indices = [], rows = 18, columns = 32;
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const f = row / rows, angle = col / columns * Math.PI * 2;
    const cap = f < .15 ? 1 : cactusCap(f);
    const ridge = .87 + .13 * Math.cos(angle * 8), r = radius * cap * ridge;
    positions.push(Math.cos(angle) * r + bend * f * f, length * f, Math.sin(angle) * r);
    // Older tissue near the soil corks slightly; the crown is fresher.
    const green = .30 + .07 * Math.cos(angle * 8) + random() * .025, cork = smoothstep(.12, 0, f) * .35, fresh = smoothstep(.75, 1, f) * .06;
    colors.push(green * (.68 + cork * .5) + fresh * .4, green * (1 - cork * .25) + fresh, green * (.60 - cork * .1) + fresh * .2); uv.push(col / columns, f);
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
    // Parts are baked in place: their geometry is discarded after merging.
    for (const object of objects) {
      object.updateMatrix(); object.geometry.applyMatrix4(object.matrix);
      object.position.set(0, 0, 0); object.quaternion.identity(); object.scale.set(1, 1, 1);
    }
    const merged = mergeGeometries(objects.map(object => object.geometry),false);
    if (!merged) continue;
    for (const object of objects) {
      object.geometry.dispose(); geometries.delete(object.geometry); content.remove(object);
    }
    const batch = mesh(merged,material,`${objects[0].name.split('-')[0]}-batch`);
    batch.userData.parts = objects.map(object => object.name);
  }
  return parts;
}

// Stem colours run from the older, browner base to fresh growth at the tip.
const STEM_TONES = { stem:['#4b5a2f','#6a8a3c'], woody:['#5a4630','#5d7336'], zz:['#2f4027','#4b6a2b'],
  palm:['#46602a','#627f38'], fern:['#4a5a2a','#6b8a3a'], petiole:['#536d2f','#739449'], vein:['#7f9955','#91a866'],
  // Ivy's wiry stems and petioles stay dark and purplish-green.
  ivy:['#4a3a2c','#4c5a31'] };

/** Scene units per millimetre of a plant shown without a shelf (the catalogue preview). */
const PREVIEW_SCALE = .5;

/** Every saved plant uses a current catalog mesh, including legacy records.
 * Its own opaque leaf texture covers real geometry; no photo cutout is used.
 * Sizes are the real IKEA ones (plant-dimensions.js): only `entry.height`,
 * the scene's height for that plant, sets the scale, so a width or height
 * saved by an older version cannot distort the pot or the foliage.
 */
export function createShelfPlant(entry) {
  const quality = entry.inspectionResolution ? 2 : 1;
  const catalogPlant = resolveCatalogPlant(entry);
  const variant = variantFor(catalogPlant?.variant || entry.variant), seed = entry.seed ?? entry.key ?? entry.node?.dataset.objectId ?? variant;
  const potId = getCatalogPot(entry.potId)?.id ?? catalogPlant?.defaultPotId ?? null;
  const potModelId = getCatalogPot(potId)?.modelId || potId;
  const real = plantDimensions(catalogPlant.id, potId);
  const height = Math.max(1, Number(entry.height) || real.height * PREVIEW_SCALE), unit = height / real.height;
  // The canopy and the pot share one mm scale, including the pot's outer rim.
  const width = real.canopy * unit;
  const detailed = Boolean(catalogPlant || potId || ['palm','fern','ivy','zz'].includes(variant));
  const random = randomFor(seed), group = new THREE.Group(), content = new THREE.Group();
  content.position.y = -height / 2; group.add(content);
  const textures = new Set(), materials = new Set(), geometries = new Set(), roots = [];
  let disposed = false;
  // Surfaces still being painted redraw the shelf once their detail is in.
  const refresh = () => { if (!disposed) group.userData.invalidate?.(); };
  const mesh = (geometry, material, name) => {
    geometries.add(geometry); materials.add(material);
    const object = new THREE.Mesh(geometry, material); object.name = name;
    object.castShadow = true; object.receiveShadow = true; content.add(object); return object;
  };
  const own = maps => { for (const texture of Object.values(maps)) textures.add(texture); return maps; };
  const radius = real.potDiameter / 2 * unit, potHeight = real.potHeight * unit;
  const soilFraction = POT_SOIL_FRACTION, soilY = potHeight * soilFraction, sink = width * .012, above = real.foliageHeight * unit;
  const growthHeight = real.referenceHeight * unit;
  const clays = ['#a97958', '#b18b6c', '#bcad94', '#826d60'];
  const potColor = getPotColor(potId,entry.potColorId);
  const clayColor = potId ? potColor.hex : clays[Math.floor(random() * clays.length)];
  const finish = POT_FINISHES[potModelId] ?? { painter:() => terracottaPainter(clayColor, 53), material:{ bumpScale:.4 } };
  const potMaps = own(surface(`pot:${potId}:${clayColor}:${quality}`, [128 * quality, 256 * quality], true, finish.painter(potColor.hex), refresh));
  // Texels stay roughly square on the outer wall, whatever the pot proportions.
  potMaps.map.repeat.x = potMaps.data.repeat.x = Math.max(1, Math.round(Math.PI * 4 * radius * (RIM - FOOT) / potHeight));
  potMaps.map.offset.x = potMaps.data.offset.x = random();
  const { bumpScale, ...finishOptions } = finish.material;
  const clay = new THREE.MeshPhysicalMaterial({ map:potMaps.map, roughnessMap:potMaps.data, bumpMap:potMaps.data, bumpScale,
    vertexColors:true, roughness:1, metalness:0, clearcoat:0, clearcoatRoughness:.3, ...finishOptions });
  const pot = potGeometry(potModelId, radius, potHeight, soilFraction);
  mesh(pot.geometry, clay, 'ceramic-pot');
  if (potId === 'muskotblomma') {
    const profile = [[0,0],[1.13,0],[1.17,.025],[1.19,.075],[1.18,.14],[1.155,.172],[1.12,.17],[1.09,.12],[1.07,.07],[.9,.067],[.74,.066],[0,.065]];
    const saucer = new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(radius * r / 1.19,potHeight * y)),40);
    const uv = saucer.attributes.uv, tones = [];
    for (let i = 0; i < uv.count; i++) {
      const j = i % profile.length;
      uv.setY(i, FOOT + .02 + j / (profile.length - 1) * .3);
      // Contact shadow where the pot foot stands in the dish.
      const tone = j >= profile.length - 3 ? [.7, .5, .45][j - profile.length + 3] : 1;
      tones.push(tone, tone, tone);
    }
    saucer.setAttribute('color', new THREE.Float32BufferAttribute(tones, 3));
    mesh(saucer,clay,'terracotta-saucer');
  }
  if (potId === 'akerbar') {
    const seamGeometry = new THREE.CylinderGeometry(width*.0015,width*.0015,potHeight*.87,5);
    seamGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(seamGeometry.attributes.position.count * 3).fill(.86), 3));
    const seam = mesh(seamGeometry,clay,'steel-folded-seam');
    seam.position.set(0,potHeight*.48,-pot.radius*.878); seam.rotation.x = -.16;
  }
  const mineral = new THREE.MeshStandardMaterial({ color:'#b7ae9c', roughness:1 });
  const stemMaterial = new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.72 });
  const leafMaps = detailed ? own(botanicalTextures(variant, refresh, quality)) : null;
  const leafMaterial = new THREE.MeshPhysicalMaterial({ map:leafMaps?.map ?? null, bumpMap:leafMaps?.data ?? null, roughnessMap:leafMaps?.data ?? null,
    color:0xffffff, vertexColors:true, bumpScale:width * (variant === 'succulent' ? .00035 : .0012),
    // Ivy is glossy rather than downy: its gloss lives in the thin clearcoat,
    // while a broad base specular would wash whole blades out to grey.
    sheen:variant === 'succulent' ? .25 : variant === 'ivy' ? 0 : .08, sheenColor:'#acc394', sheenRoughness:.85,
    side:THREE.DoubleSide, alphaTest:0, alphaToCoverage:false, specularIntensity:variant === 'ivy' ? .1 : .6,
    roughness:variant === 'zz' ? .55 : variant === 'ivy' ? .66 : variant === 'succulent' ? .88 : .85, metalness:0,
    clearcoat:variant === 'zz' ? .32 : variant === 'ivy' ? .1 : variant === 'succulent' ? .035 : .12, clearcoatRoughness:variant === 'ivy' ? .3 : .48 });
  const stem = (path, r, name, { tubular = 8, radial = 4, tone = 'stem', taper = [1, 1] } = {}) => {
    const curve = Array.isArray(path) ? new THREE.CatmullRomCurve3(path) : path;
    const geometry = new THREE.TubeGeometry(curve, tubular, r, radial, false);
    const position = geometry.attributes.position, colors = new Float32Array(position.count * 3);
    const [from, to] = STEM_TONES[tone].map(hex => new THREE.Color(hex)), colour = new THREE.Color(), centre = new THREE.Vector3();
    for (let i = 0; i <= tubular; i++) {
      const f = i / tubular, scale = taper[0] + (taper[1] - taper[0]) * f;
      curve.getPointAt(f, centre); colour.copy(from).lerp(to, Math.min(1, f * 1.6));
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        if (scale !== 1) position.setXYZ(k, centre.x + (position.getX(k) - centre.x) * scale, centre.y + (position.getY(k) - centre.y) * scale, centre.z + (position.getZ(k) - centre.z) * scale);
        colors[k * 3] = colour.r; colors[k * 3 + 1] = colour.g; colors[k * 3 + 2] = colour.b;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const first = curve.getPointAt(0);
    // Only stems that enter the soil root the plant (not petioles on hanging vines).
    if (first.y <= soilY + 1e-6 && Math.hypot(first.x, first.z) < radius * .9) roots.push([first.x, first.z, r * taper[0]]);
    return mesh(geometry, stemMaterial, name);
  };
  const blade = (position, direction, length, leafWidth, angle, curve, twist, index, facing = null) => {
    const parameters = { length, width:leafWidth, variant, curve, twist, random, detailed };
    const geometry = variant === 'ivy' ? ivyLeafGeometry(length,leafWidth,curve,random)
      : catalogPlant && variant === 'monstera' ? monsteraLeafGeometry(length,leafWidth,curve,random) : leafGeometry(parameters);
    const leaf = mesh(geometry, leafMaterial, `leaf-${index}`), axis = direction.clone().normalize();
    leaf.position.copy(position);
    leaf.quaternion.setFromUnitVectors(UP, axis);
    let roll = angle;
    if (facing) {
      // Turn the lamina about its own midrib until it faces the light.
      const target = facing.clone().projectOnPlane(axis);
      if (target.lengthSq() > 1e-8) roll += Math.atan2(target.dot(new THREE.Vector3(1,0,0).applyQuaternion(leaf.quaternion)), target.dot(new THREE.Vector3(0,0,1).applyQuaternion(leaf.quaternion)));
    }
    leaf.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
    if (position.y <= soilY && Math.hypot(position.x, position.z) < radius * .9) roots.push([position.x, position.z, leafWidth * .3]);
    if (variant === 'monstera' || variant === 'leafy') {
      // The raised midrib follows the lamina it sits on, from the notch to
      // just short of the tip (the catalog Monstera blade has its own shape).
      const rib = width * .0015, carved = catalogPlant && variant === 'monstera';
      const along = f => carved ? new THREE.Vector3(0, f * .78 * length, Math.sin((.12 + f * .78) * Math.PI) * length * curve + rib * .5)
        : bladePoint(f, 0, length, leafWidth, variant, curve, twist);
      stem([0,.2,.43,.67,.9].map(f => along(f).applyQuaternion(leaf.quaternion).add(position)), rib, `leaf-vein-${index}`, { tubular:6, tone:'vein', taper:[1.3,.5] });
    }
    return leaf;
  };
  if (variant === 'cactus') {
    const green = new THREE.MeshStandardMaterial({ color:0xffffff, vertexColors:true, roughness:.8 });
    const spikes = [], columns = [ {x:0,z:0,length:growthHeight * .71,radius:width * .12},
      {x:-width*.16,z:width*.03,length:growthHeight*.47,radius:width*.085},
      {x:width*.165,z:-width*.055,length:growthHeight*.36,radius:width*.083} ];
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index], bend = (random() - .5) * width * .09, base = soilY - column.length * .06;
      // The column enters the grit at full girth instead of resting on a rounded foot.
      const trunk = mesh(cactusGeometry(column.length, column.radius, bend, random), green, `cactus-column-${index}`);
      trunk.position.set(column.x, base, column.z); roots.push([column.x, column.z, column.radius]);
      for (let row = 1; row < 7; row++) for (let ridge = 0; ridge < 8; ridge++) {
        const f = row / 8, angle = ridge / 8 * Math.PI * 2, radiusAt = column.radius * cactusCap(f);
        const p = new THREE.Vector3(column.x + Math.cos(angle) * radiusAt + bend * f * f, base + column.length * f, column.z + Math.sin(angle) * radiusAt);
        const areoleGeometry = new THREE.SphereGeometry(width*.0065,4,3);
        const areole = mesh(areoleGeometry.toNonIndexed(),mineral,`cactus-areole-${index}-${row}-${ridge}`);
        areoleGeometry.dispose();
        areole.position.copy(p); areole.scale.set(1,.8,1);
        for (const tilt of [-1,-.45,0,.45,1]) {
          const tip = p.clone().add(new THREE.Vector3(Math.cos(angle) * width * .023, width * .018 * tilt, Math.sin(angle) * width * .023));
          spikes.push(...p.toArray(), ...tip.toArray());
        }
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(spikes, 3));
    const material = new THREE.LineBasicMaterial({ color:'#d9cda9', transparent:true, opacity:.8 });
    const needles = new THREE.LineSegments(geometry, material); needles.name = 'cactus-areoles'; content.add(needles);
    geometries.add(geometry); materials.add(material);
  } else if (variant === 'upright') {
    for (let i = 0; i < 8; i++) {
      const angle = i * 2.39996, spread = width * (.045 + (i % 3) * .028);
      const position = new THREE.Vector3(Math.cos(angle) * spread, soilY - sink, Math.sin(angle) * spread);
      const direction = new THREE.Vector3(Math.cos(angle) * (.06 + (i % 3) * .035), 1, Math.sin(angle) * .055);
      blade(position, direction, growthHeight * (i === 0 ? .74 : .50 + random() * .21), width * (catalogPlant ? .29 + random()*.075 : .24 + random() * .055), catalogPlant ? (i%3-1)*.38 : angle * .38,
        .035 + random() * .03, (random() - .5) * .22, i);
    }
  } else if (variant === 'succulent') {
    const count = catalogPlant ? 27 : 9;
    // An Echeveria rosette in four tiers, sized to the pot: flat outer leaves
    // rest over the lip, inner ones close into a tight cone. Only a very tall
    // envelope lifts it on an aged, woody stem.
    const leaf = Math.min(radius * 1.55, above * .75, width * .45);
    const crown = catalogPlant ? soilY + Math.max((potHeight - soilY) * .75, Math.min(above * .4, above - leaf * 1.85)) : soilY;
    if (catalogPlant) stem([new THREE.Vector3(0, soilY - sink, 0), new THREE.Vector3(width * .012, (soilY + crown) / 2, 0), new THREE.Vector3(0, crown, 0)],
      width * .034, 'succulent-stem', { tubular:4, radial:6, tone:'woody', taper:[1.15,.85] });
    for (let i = 0; i < count; i++) {
      const tier = catalogPlant ? (i < 12 ? 0 : i < 20 ? 1 : i < 25 ? 2 : 3) : 0;
      const angle = i * 2.39996, ring = catalogPlant ? [.95,.72,.42,.2][tier] : i < 5 ? .55 : .22;
      const direction = new THREE.Vector3(Math.cos(angle) * ring,catalogPlant ? [.4,.85,1.6,3.2][tier] : .65 + (i % 3) * .10,Math.sin(angle) * ring);
      const size = catalogPlant ? .92 + random() * .16 : 1;
      // Each fleshy leaf keeps its concave upper face turned to the sky.
      blade(new THREE.Vector3(Math.cos(angle)*width*.02,crown + (catalogPlant ? tier*leaf*.1 : 0),Math.sin(angle)*width*.02), direction,
        catalogPlant ? leaf * [1,.92,.8,.62][tier] * size : growthHeight * (i < 5 ? .58 : .51),
        catalogPlant ? leaf * [.62,.58,.5,.42][tier] * size : width * (.22 + random()*.035),
        catalogPlant ? 0 : angle,catalogPlant ? .05 : .09,(random()-.5)*.16,i,catalogPlant ? UP : null);
    }
  } else if (variant === 'palm') {
    const fronds = 10, pairs = 11;
    let index = 0;
    for (let i = 0; i < fronds; i++) {
      const angle = i * 2.39996 + random() * .25;
      const radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const lateral = new THREE.Vector3(-radial.z,0,radial.x);
      const root = radial.clone().multiplyScalar(width * .035); root.y = soilY - sink;
      const reach = width * .34 * (.72 + random() * .28);
      const apex = above * (.4 + (i % 4)*.15 + random()*.05);
      const curve = new THREE.CatmullRomCurve3([
        root,
        root.clone().add(radial.clone().multiplyScalar(reach*.16)).add(new THREE.Vector3(0,apex*.61,0)),
        root.clone().add(radial.clone().multiplyScalar(reach*.57)).add(new THREE.Vector3(0,apex,0)),
        root.clone().add(radial.clone().multiplyScalar(reach)).add(new THREE.Vector3(0,apex*.59,0)),
      ]);
      stem(curve,width*.0042,`palm-rachis-${i}`,{ tubular:12, radial:5, tone:'palm', taper:[1.25,.45] });
      for (let p = 0; p < pairs; p++) {
        const f = .21 + p / (pairs-1) * .71;
        const at = curve.getPoint(f), taper = Math.pow(Math.sin((.14 + p / (pairs-1)*.79)*Math.PI),.60), size = .88 + random() * .24;
        for (const side of [-1,1]) {
          const direction = lateral.clone().multiplyScalar(side*.74).add(radial.clone().multiplyScalar(.38));
          direction.y = -.17 - p / pairs * .27;
          blade(at,direction,growthHeight * .225 * taper * size,width * .030 * taper,side*.18,.13,(random()-.5)*.12,index++);
        }
      }
      blade(curve.getPoint(.90),curve.getTangent(.92),growthHeight*.075,width*.026,0,.065,0,index++);
    }
  } else if (variant === 'fern') {
    // Nephrolepis: a full crown of arching fronds, the young ones upright in
    // the centre, each carrying dense alternate pinnae that face the light.
    const fronds = 18, pairs = 18, sky = new THREE.Vector3(0,1,.35);
    let index = 0;
    for (let i = 0; i < fronds; i++) {
      const young = i < 4, angle = i * 2.39996 + random() * .3;
      const radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const root = radial.clone().multiplyScalar(width * .03); root.y = soilY - sink;
      const reach = width * (young ? .17 : .38) * (.8 + random() * .25);
      const apex = above * (young ? .78 + random() * .1 : .46 + random() * .2);
      const drop = young ? apex * .9 : apex * (.25 + random() * .35);
      const curve = new THREE.CatmullRomCurve3([
        root,
        root.clone().add(radial.clone().multiplyScalar(reach * .12)).add(new THREE.Vector3(0,apex * .6,0)),
        root.clone().add(radial.clone().multiplyScalar(reach * .55)).add(new THREE.Vector3(0,apex,0)),
        root.clone().add(radial.clone().multiplyScalar(reach)).add(new THREE.Vector3(0,drop,0)),
      ]);
      stem(curve,width*.0036,`fern-rachis-${i}`,{ tubular:14, radial:3, tone:'fern', taper:[1.2,.35] });
      for (let p = 0; p < pairs; p++) {
        const f = .1 + p / (pairs - 1) * .86, taper = Math.pow(Math.sin((.1 + p / (pairs - 1) * .86) * Math.PI), .55);
        const tangent = curve.getTangentAt(f), side = new THREE.Vector3().crossVectors(tangent, UP).normalize();
        if (side.lengthSq() < .5) side.copy(radial).cross(UP).normalize();
        for (const hand of [-1,1]) {
          const at = curve.getPointAt(Math.min(1, f + (hand > 0 ? .012 : 0)));
          const direction = side.clone().multiplyScalar(hand * .88).add(tangent.clone().multiplyScalar(.4)); direction.y -= .05;
          blade(at,direction,growthHeight * .105 * taper * (.88 + random() * .24),width * .03 * taper,0,.06,(random()-.5)*.2,index++,sky);
        }
      }
      blade(curve.getPointAt(.97),curve.getTangentAt(.97),growthHeight*.05,width*.02,0,.05,0,index++,sky);
    }
  } else if (variant === 'zz') {
    let index = 0;
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.39996, radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const sideAxis = new THREE.Vector3(-radial.z,0,radial.x);
      const root = radial.clone().multiplyScalar(width*.065); root.y = soilY - sink;
      const length = growthHeight * (.49 + random() * .22);
      const endpoint = root.clone().add(radial.clone().multiplyScalar(width*(.08+random()*.12))).add(new THREE.Vector3(0,length,0));
      const curve = new THREE.CatmullRomCurve3([root,root.clone().lerp(endpoint,.50).add(radial.clone().multiplyScalar(-width*.04)),endpoint]);
      // Zamioculcas petioles swell into a bulbous base at the soil.
      stem(curve,width*.011,`zamioculcas-stem-${i}`,{ tubular:12, radial:6, tone:'zz', taper:[1.45,.7] });
      for (let pair = 0; pair < 5; pair++) for (const side of [-1,1]) {
        const f = .28 + pair*.135, at = curve.getPoint(f);
        const axis = sideAxis.clone().multiplyScalar(side*.66).add(radial.clone().multiplyScalar(.24)).add(new THREE.Vector3(0,.61,0));
        const size = (1 - pair*.07) * (.92 + random() * .16);
        blade(at,axis,growthHeight*.17*size,width*.15*size,side*.2,.07,(random()-.5)*.15,index++);
      }
      blade(curve.getPoint(.94),new THREE.Vector3(radial.x*.3,1,radial.z*.3),growthHeight*.12,width*.12,0,.05,0,index++);
    }
  } else if (variant === 'ivy') {
    // Hedera as it grows in a pot: a dense mound of short arching shoots over
    // the soil, longer shoots that lean out and nod over at the tip, and vines
    // spilling over the rim. Leaves alternate on short petioles, broad low on
    // each shoot and smaller towards the growing tip.
    const unit = Math.min(width * .26, growthHeight * .12), sky = new THREE.Vector3(0,.5,.55);
    let index = 0, vine = 0;
    const shoot = (angle, path, leaves, { size = 1, from = .14 } = {}) => {
      const radial = new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)), across = new THREE.Vector3(-radial.z,0,radial.x), up = new THREE.Vector3();
      const root = radial.clone().multiplyScalar(width * .04); root.y = soilY - sink;
      // [out, growthHeight, sway]: a gentle zigzag from node to node, as ivy grows.
      const curve = new THREE.CatmullRomCurve3([root, ...path.map(([r, y, sway = 0]) => radial.clone().multiplyScalar(r).addScaledVector(across, sway).add(up.set(0, y, 0)))]);
      stem(curve,width*.0042,`ivy-vine-${vine++}`,{ tubular:12, radial:4, tone:'ivy', taper:[1.1,.55] });
      for (let j = 0; j < leaves; j++) {
        // Internodes shorten towards the tip.
        const f = from + (1 - from) * Math.pow((j + .35 + random() * .3) / leaves, .85), tangent = curve.getTangentAt(f);
        const side = new THREE.Vector3().crossVectors(tangent, UP);
        if (side.lengthSq() < 1e-4) side.copy(radial).cross(UP);
        side.normalize();
        const axis = side.multiplyScalar(j % 2 ? .78 : -.78).add(radial.clone().multiplyScalar(.42)).add(up.set(0,.5,0)).normalize();
        const scale = size * (1.08 - .62 * Math.pow(f, 1.4)) * (.86 + random() * .28);
        // A short petiole holds each blade clear of the vine.
        const at = curve.getPointAt(f), base = at.clone().addScaledVector(axis, unit * .38 * scale);
        stem([at, at.clone().lerp(base, .5).add(up.set(0, unit * .06, 0)), base], width * .0022, `ivy-petiole-${index}`, { tubular:2, radial:3, tone:'ivy' });
        blade(base,axis,unit*scale,unit*1.08*scale,0,.07,(random()-.5)*.3,index++,radial.clone().multiplyScalar(.8).add(sky));
      }
    };
    const lip = radius * 1.04, turn = random() * Math.PI * 2;
    // Low mound: short shoots arch up and out over the soil.
    for (let i = 0; i < 6; i++) {
      const rise = above * (.16 + random() * .12), out = width * (.2 + random() * .1);
      shoot(turn + i * 2.39996, [[out * .35, soilY + rise * .8], [out * .75, soilY + rise], [out, soilY + rise * .7]], 5, { size:1.05, from:.2 });
    }
    // Longer shoots lean out in every direction and nod over at the tip,
    // giving an open, rounded crown rather than a single staked column.
    for (let k = 0; k < 4; k++) {
      const peak = above * (.97 - k * .11) * (.94 + random() * .08), lean = width * (.2 + random() * .05), sway = width * .035 * (k % 2 ? 1 : -1);
      shoot(turn + .5 + k * Math.PI / 2 + (random() - .5) * .5, [[lean * .45, soilY + peak * .38, sway], [lean * .85, soilY + peak * .74, -sway],
        [lean * 1.1, soilY + peak, sway * .6], [lean * 1.4, soilY + peak * .9]], 11 - (k >> 1), { size:1.08 });
    }
    // Vines spill over the rim and hang down the pot.
    for (let i = 0; i < 6; i++) {
      const drop = potHeight * (.1 + random() * .35);
      shoot(turn + 1.3 + i * 2.39996, [[width * .1, soilY + growthHeight * .06], [lip + width * .03, potHeight + growthHeight * .03],
        [lip + width * .07, (potHeight + drop) * .6], [lip + width * (.09 + random() * .06), drop]], 6, { size:.92, from:.22 });
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
      const leaf = leaves[i], endpoint = new THREE.Vector3(leaf.x * width, soilY + leaf.y * growthHeight, leaf.z * width);
      const root = new THREE.Vector3(leaf.x * width * .13, soilY - sink, leaf.z * width * .13);
      const middle = new THREE.Vector3(endpoint.x * .42, soilY + growthHeight * (i === 5 || i === 6 ? .26 : leaf.y * .65), endpoint.z * .45);
      stem([root, middle, endpoint], width * .008, `petiole-${i}`, { tone:'petiole' });
      blade(endpoint, new THREE.Vector3(...leaf.axis), growthHeight * leaf.length, width * leaf.width,
        (random() - .5) * .36, .08 + random() * .05, (random() - .5) * .26, i);
    }
  } else {
    const count = variant === 'monstera' ? 5 : 8;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996 + .30, spread = width * (.10 + random() * .075);
      const endpoint = new THREE.Vector3(Math.cos(angle) * spread, soilY + growthHeight * (.22 + random() * .14), Math.sin(angle) * spread * .8);
      const root = new THREE.Vector3(Math.cos(angle) * width * .025, soilY - sink, Math.sin(angle) * width * .025);
      stem([root, new THREE.Vector3(endpoint.x * .34, soilY + growthHeight * .13, endpoint.z * .34), endpoint], width * (variant === 'monstera' ? .012 : .008), `petiole-${i}`,
        { tone:'petiole', taper:[1.2,.85] });
      const direction = new THREE.Vector3(Math.cos(angle) * .35, 1, Math.sin(angle) * .18);
      blade(endpoint, direction, growthHeight * (variant === 'monstera' ? .38 : .34) * (.94 + random() * .12), width * (variant === 'monstera' ? .43 : .32),
        Math.sin(angle) * .6, .11 + random() * .045, (random() - .5) * .40, i);
    }
  }
  const soilKind = variant === 'cactus' || variant === 'succulent' ? 'grit' : 'peat';
  const soilMaps = own(surface(`soil:${soilKind}:${quality}`, [128 * quality, 128 * quality], false, soilPainter(soilKind), refresh));
  const soil = new THREE.MeshStandardMaterial({ map:soilMaps.map, roughnessMap:soilMaps.data, bumpMap:soilMaps.data,
    bumpScale:soilKind === 'grit' ? 1.4 : 1.1, roughness:1, vertexColors:true });
  mesh(soilGeometry(pot.soilRadius * .995, soilY, random, roots, soilKind), soil, 'potting-soil');
  const parts = consolidateParts(content, mesh, geometries);
  // Only the foliage is fitted to the promised collision envelope: the pot
  // stays round and true to size, and the ceramic base remains at -height/2.
  const foliage = new THREE.Group(); foliage.name = 'plant-foliage';
  for (const object of [...content.children]) if (object.material !== clay && object.material !== soil) foliage.add(object);
  content.add(foliage); content.updateWorldMatrix(true, false);
  const leafBounds = new THREE.Box3().setFromObject(foliage);
  const xExtent = Math.max(Math.abs(leafBounds.min.x), Math.abs(leafBounds.max.x), 1e-6);
  const zExtent = Math.max(Math.abs(leafBounds.min.z), Math.abs(leafBounds.max.z), 1e-6);
  // Foliage stretches about the soil line to reach the envelope's top, never
  // so far that trailing stems would pass below the base of the pot.
  const top = leafBounds.max.y + height / 2, low = leafBounds.min.y + height / 2;
  const stretch = Math.min(above / Math.max(1e-6, top - soilY), low < soilY ? soilY / (soilY - low) : Infinity);
  // Width follows the same factor where the envelope allows, so a small
  // rosette grows as a plant rather than being pulled into spikes; stems
  // still have to rise from the soil inside the pot wall.
  const rooted = pot.soilRadius * .97 / Math.max(1e-6, ...roots.map(([x, z, r]) => Math.hypot(x, z) + r));
  foliage.scale.set(Math.min(stretch, width / 2 / xExtent, rooted), stretch, Math.min(stretch, width * .35 / zExtent, rooted));
  foliage.position.y = soilY * (1 - stretch);
  const bounds = new THREE.Box3().setFromObject(content);
  // Preserve the measured pot height; never stretch the whole assembly.
  const correction = (height - soilY) / Math.max(1e-6, bounds.max.y + height / 2 - soilY);
  foliage.scale.y *= correction; foliage.position.y = soilY * (1 - foliage.scale.y);
  group.userData.variant = variant; group.userData.seed = String(seed);
  group.userData.catalogId = catalogPlant?.id ?? null; group.userData.potId = potId; group.userData.potColorId = potColor.id;
  group.userData.parts = parts;
  group.userData.inspectionResolution = entry.inspectionResolution || 0;
  if (quality > 1) group.userData.ready = plantSurfacesReady().then(() => !disposed);
  group.userData.dispose = () => {
    if (disposed) return; disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };
  // Materials created for an unused variant do not enter the scene traversal.
  for (const material of [stemMaterial, leafMaterial, mineral]) if (!materials.has(material)) material.dispose();
  return group;
}

export default createShelfPlant;
