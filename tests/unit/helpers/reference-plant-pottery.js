// Frozen terracotta/zinc painters from 1.7.148.
const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const srgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

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

const FOOT = .07, RIM = .6, SOIL = .74;

// Rows below the soil line are never visible.
const hidden = (v, texel) => {
  if (v < SOIL + .03) return false;
  texel[0] = texel[1] = texel[2] = .2; texel[3] = .5; texel[4] = 1; return true;
};

export function terracottaPainter(hex, seed) {
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

export function galvanizedPainter(seed, hex = '#cfd3d5') {
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

