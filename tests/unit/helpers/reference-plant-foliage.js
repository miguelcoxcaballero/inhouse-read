// Frozen foliage painters from 1.7.149.
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

const surface=(key,size,repeat,paint)=>paint;
const SNAKE_STRIPS = 4, SNAKE_INSET = .04;

export function sansevieriaTextures(refresh, quality = 1) {
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

export function botanicalTextures(variant, refresh, quality = 1) {
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

