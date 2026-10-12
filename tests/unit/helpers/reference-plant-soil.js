// Frozen soil painter from 1.7.149.
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

export function soilPainter(kind) {
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

