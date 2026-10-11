// Frozen weave calculation from 7ca8e6d, before the Rust migration.
const lattice = (i, j, salt) => {
 let h = Math.imul(i * 374761393 + j * 668265263 + salt * 1442695041 | 0, 1274126177);
 h = Math.imul(h ^ h >>> 13, 1103515245);
 return ((h ^ h >>> 16) >>> 0) / 4294967296;
};
export function bookWeave() {
 const shade = new Float32Array(64 * 64);
    for (let y = 0; y < 128; y += 2) for (let x = 0; x < 128; x += 2) {
      const i = x >> 3, j = y >> 3, warp = (i + j) % 2
      const lift = warp ? Math.sin(Math.PI * (x % 8 + 1) / 8) : Math.sin(Math.PI * (y % 8 + 1) / 8)
      const yarn = warp ? lattice(i, y >> 4, 3) : lattice(j, x >> 4, 4)
      shade[(y >> 1) * 64 + (x >> 1)] = (lift - .62) * (.6 + yarn * .8) + (lattice(i, j, 5) - .5) * .25
    }
 const tiles = {};
 for (const name of ['color','channels']) {
 const data = new Uint8ClampedArray(128 * 128 * 4);
        for (let p = 0; p < 128 * 128; p++) {
          const s = shade[(p >> 8) * 64 + ((p & 127) >> 1)], k = p * 4
          if (name === 'color') {
            // Shadowed gaps carry the weave; a bright dot at every crossing
            // read as a screen door on phones, so the crowns barely lighten.
            data.set(s > 0 ? [255, 248, 236, Math.round(s * .035 * 255)] : [0, 0, 0, Math.round(-s * .075 * 255)], k)
          } else {
            // Multiplied into R height / G roughness: gaps sink, crowns are
            // burnished smoother, metalness (B) is untouched.
            data.set([Math.round(255 * (1 - Math.max(0, -s) * .16)), Math.round(255 * (1 - Math.max(0, s) * .2)), 255, 255], k)
          }
        }
 tiles[name] = data;
 }
 return tiles;
}
