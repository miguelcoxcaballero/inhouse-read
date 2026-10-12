// Frozen full-resolution pottery painter from 1.7.147.
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

export function glazedPainter({ glaze, body, gloss, speckle, crackle, seed }) {
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

