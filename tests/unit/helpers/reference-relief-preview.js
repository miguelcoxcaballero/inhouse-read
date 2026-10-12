const MAX_RELIEF_MM=.6;const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export function* shadePreview(image, maps, { slope = 7 } = {}) {
  const { width, height, data } = image, out = new Uint8ClampedArray(width * height * 4);
  const light = [-.52, .58, .63], lightLength = Math.hypot(...light);
  light[0] /= lightLength; light[1] /= lightLength; light[2] /= lightLength;
  const half = [light[0], light[1], light[2] + 1], halfLength = Math.hypot(...half);
  half[0] /= halfLength; half[1] /= halfLength; half[2] /= halfLength;
  const hmap = maps.heightMap, mw = maps.width, mh = maps.height;
  const sample = (x, y) => hmap[clamp(Math.round(y * mh / height), 0, mh - 1) * mw + clamp(Math.round(x * mw / width), 0, mw - 1)];
  const k = slope * MAX_RELIEF_MM / 255 * 14;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const mapIndex = clamp(Math.round(y * mh / height), 0, mh - 1) * mw + clamp(Math.round(x * mw / width), 0, mw - 1);
    if (maps.preserveInk && !maps.mask[mapIndex]) {
      out.set(data.subarray(i, i + 4), i);
      if (x === width - 1 && (y & 7) === 7) yield;
      continue;
    }
    const nx = -(sample(x + 1, y) - sample(x - 1, y)) * k, ny = (sample(x, y + 1) - sample(x, y - 1)) * k;
    const length = Math.hypot(nx, ny, 1), n = [nx / length, ny / length, 1 / length];
    const diffuse = n[0] * light[0] + n[1] * light[1] + n[2] * light[2];
    const shade = clamp(1 + (diffuse - light[2]) * 2.6, .45, 1.55);
    const spec = Math.max(0, n[0] * half[0] + n[1] * half[1] + n[2] * half[2]) ** 40;
    const mx = clamp(Math.round(x * mw / width), 0, mw - 1), my = clamp(Math.round(y * mh / height), 0, mh - 1);
    const foil = maps.foil[my * mw + mx] / 255, gloss = maps.gloss[my * mw + mx] / 255;
    const shine = (spec * (.35 + 1.5 * foil + .7 * gloss) + gloss * .05 + foil * .12) * 255;
    for (let c = 0; c < 3; c++) {
      const base = data[i + c] * shade;
      out[i + c] = base + (foil ? (255 - base) * Math.min(.9, shine / 255) * .9 : shine * .6);
    }
    out[i + 3] = maps.preserveInk ? data[i + 3] : 255;
    if (x === width - 1 && (y & 7) === 7) yield;
  }
  return out;
}

