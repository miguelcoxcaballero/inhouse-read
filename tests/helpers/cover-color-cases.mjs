// Deterministic pixel inputs shared by parity and full-bridge benchmarks.
export const coverColorCases = [
  { name:'flat-cloth', width:192, height:288, kind:'flat' },
  { name:'two-ink-cover', width:192, height:288, kind:'split' },
  { name:'photographic-colors', width:192, height:288, kind:'noise' },
  { name:'gradient-cover', width:192, height:288, kind:'gradient' },
  { name:'transparent-cutout', width:192, height:288, kind:'alpha' },
  { name:'mixed-transparency', width:192, height:288, kind:'mixed-alpha' },
  { name:'small-thumbnail', width:24, height:32, kind:'noise' },
  { name:'stride-one-limit', width:71, height:101, kind:'noise' },
  { name:'stride-two-start', width:72, height:100, kind:'noise' },
  { name:'landscape-cover', width:192, height:111, kind:'gradient' },
];
export function createCoverColorPixels({ width, height, kind }, seed = 0x17839aef) {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0;
  const randomByte = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state >>> 24; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    let color;
    if (kind === 'flat') color = [47, 107, 79];
    else if (kind === 'split') color = x < width * .8 ? [47, 107, 79] : [238, 228, 211];
    else if (kind === 'gradient') color = [Math.round(x / Math.max(1, width - 1) * 255),
      Math.round(y / Math.max(1, height - 1) * 255), Math.round((x + y) / Math.max(1, width + height - 2) * 255)];
    else color = [randomByte(), randomByte(), randomByte()];
    data.set(color, at);
    data[at + 3] = kind === 'alpha' ? [0, 47, 48, 127, 255][(x * 3 + y) % 5]
      : kind === 'mixed-alpha' ? [0, 47, 48, 127, 255][(x * 3 + y + Math.floor(y / 7)) % 5] : 255;
  }
  return data;
}
