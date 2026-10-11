// Frozen independent JavaScript reference algorithms from 7eb558a, shared by
// Node differential tests and browser parity/performance observations.
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const toByte = value => Math.round(clamp(value, 0, 1) * 255);

function referenceDistance(mask, width, height) {
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e6 : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * width + x;
    if (!d[at]) continue;
    let v = d[at];
    if (x > 0) v = Math.min(v, d[at - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[at - width] + 1);
      if (x > 0) v = Math.min(v, d[at - width - 1] + 1.4142);
      if (x < width - 1) v = Math.min(v, d[at - width + 1] + 1.4142);
    }
    d[at] = v;
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const at = y * width + x;
    if (!d[at]) continue;
    let v = d[at];
    if (x < width - 1) v = Math.min(v, d[at + 1] + 1);
    if (y < height - 1) {
      v = Math.min(v, d[at + width] + 1);
      if (x < width - 1) v = Math.min(v, d[at + width + 1] + 1.4142);
      if (x > 0) v = Math.min(v, d[at + width - 1] + 1.4142);
    }
    d[at] = v;
  }
  return d;
}

function referenceBlur(field, width, height, radius) {
  const middle = new Float32Array(field.length), out = new Float32Array(field.length), size = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += field[y * width + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      middle[y * width + x] = sum / size;
      sum += field[y * width + clamp(x + radius + 1, 0, width - 1)] - field[y * width + clamp(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += middle[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / size;
      sum += middle[clamp(y + radius + 1, 0, height - 1) * width + x] - middle[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return out;
}

function referenceNormals(maps, gain = 1) {
  const { width, height, heightMap } = maps, out = new Uint8ClampedArray(width * height * 4);
  const unit = .6 / 255 / (2 * (200 / Math.max(width, height))) * gain;
  const at = (x, y, owner) => {
    const index = clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
    return maps.owners && maps.owners[index] !== owner ? 0 : heightMap[index];
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const owner = maps.owners?.[y * width + x];
    const nx = -(at(x + 1, y, owner) - at(x - 1, y, owner)) * unit;
    const ny = (at(x, y + 1, owner) - at(x, y - 1, owner)) * unit;
    const length = Math.hypot(nx, ny, 1), i = (y * width + x) * 4;
    if (maps.preserveInk && !maps.mask[y * width + x]) out.set([128, 128, 255, 255], i);
    else {
      out[i] = (nx / length * .5 + .5) * 255;
      out[i + 1] = (ny / length * .5 + .5) * 255;
      out[i + 2] = (1 / length * .5 + .5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function referenceProfile(choice) {
  let seed = parseInt(choice.color.slice(1), 16);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  const fraction = ((seed ^ (seed >>> 16)) >>> 0) / 0xffffffff;
  return { roughness:.012 + fraction * .018, clearcoatRoughness:.01 + fraction * .018 };
}

function materialCoefficients(maps, { clearcoat = 0, roughness = .5, clearcoatRoughness = .18 } = {}) {
  return {
    base:clamp(clearcoat, 0, 1), foilRoughness:clamp(.3 / Math.max(.05, roughness), .2, 1),
    glossRoughness:clamp(.05 / Math.max(.01, roughness), 0, 1),
    glossCoatRoughness:clamp(.05 / Math.max(.01, clearcoatRoughness), 0, 1),
    profiles:maps.layers?.map(layer => {
      const profile = referenceProfile(layer);
      return { roughness:clamp(profile.roughness / Math.max(.01, roughness), 0, 1),
        clearcoatRoughness:clamp(profile.clearcoatRoughness / Math.max(.01, clearcoatRoughness), 0, 1) };
    })
  };
}

function referenceMaterial(maps, options) {
  const { base, foilRoughness, glossRoughness, glossCoatRoughness, profiles } = materialCoefficients(maps, options);
  const out = new Uint8ClampedArray(maps.width * maps.height * 4);
  for (let i = 0; i < maps.width * maps.height; i++) {
    const f = maps.preserveInk ? 0 : maps.foil[i] / 255, g = maps.gloss[i] / 255;
    const profile = profiles?.[maps.owners[i] - 1];
    const localRoughness = profile?.roughness ?? glossRoughness;
    const localCoatRoughness = profile?.clearcoatRoughness ?? glossCoatRoughness;
    out[i * 4] = (base + (1 - base) * g) * 255;
    out[i * 4 + 1] = (1 - Math.max(f * (1 - foilRoughness), g * (1 - localRoughness))) * 255;
    out[i * 4 + 2] = f * 255;
    out[i * 4 + 3] = maps.preserveInk ? (1 - g * (1 - localCoatRoughness)) * 255 : 255;
  }
  return out;
}

function referenceCompose(maps, layers) {
  const count = maps.width * maps.height;
  const out = { ...maps, layers, heightMap:new Uint8Array(count), mask:new Uint8Array(count),
    gloss:new Uint8Array(count), foil:new Uint8Array(count) };
  for (let i = 0; i < count; i++) {
    const layer = layers[maps.owners[i] - 1];
    if (layer?.strength > 0) {
      out.mask[i] = maps.baseMask[i];
      out.gloss[i] = toByte(maps.baseMask[i] / 255 * layer.strength);
      out.heightMap[i] = Math.round(maps.baseHeight[i] * layer.strength);
    }
  }
  return out;
}

const colors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ff8000', '#646464'];
const layers = colors.map((color, index) => ({ color, id:`color-${index + 1}`, tolerance:6, strength:index / 10 })).sort((a, b) => a.color.localeCompare(b.color));
function mapsFor(width, height, seed = 11, withOwners = true) {
  const count = width * height;
  let state = seed;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state >>> 24; };
  return { width, height, heightMap:Uint8Array.from({ length:count }, next),
    foil:Uint8Array.from({ length:count }, next), gloss:Uint8Array.from({ length:count }, next),
    mask:Uint8Array.from({ length:count }, () => next() > 80 ? 255 : 0),
    owners:withOwners ? Uint8Array.from({ length:count }, () => next() % 12) : undefined,
    layers:withOwners ? layers : undefined, preserveInk:withOwners,
    baseMask:Uint8Array.from({ length:count }, next),
    baseHeight:Float32Array.from({ length:count }, () => next() * .67) };
}

export { referenceDistance, referenceBlur, referenceNormals, referenceMaterial, referenceCompose, materialCoefficients, layers, mapsFor };
