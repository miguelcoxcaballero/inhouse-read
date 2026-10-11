// Frozen pixel algorithm from 21e133a, before the Rust migration.
const THREE={MathUtils:{lerp:(x,y,t)=>(1-t)*x+t*y}};
const lattice = (i, j, salt) => {
  let h = Math.imul(i * 374761393 + j * 668265263 + salt * 1442695041 | 0, 1274126177)
  h = Math.imul(h ^ h >>> 13, 1103515245)
  return ((h ^ h >>> 16) >>> 0) / 4294967296
}
function tileNormals(size, heightAt, strength) {
  const field = new Float32Array(size * size), data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) field[y * size + x] = heightAt(x, y);
  const at = (x, y) => field[(y + size) % size * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (at(x - 1, y) - at(x + 1, y)) * strength, ny = (at(x, y - 1) - at(x, y + 1)) * strength;
    const length = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    data[i] = (nx / length + 1) * 127.5; data[i + 1] = (ny / length + 1) * 127.5;
    data[i + 2] = (1 / length + 1) * 127.5; data[i + 3] = 255;
  }
  return data;
}
// Plain-weave book cloth: 16 Ãƒâ€” 16 threads per tile, with uneven slubs.
const clothNormals = () => tileNormals(128, (x, y) => {
  const i = x >> 3, j = y >> 3, fx = (x % 8 + .5) / 8, fy = (y % 8 + .5) / 8;
  const warp = Math.sin(Math.PI * fx) * (.7 + .6 * lattice(i, y >> 5, 1));
  const weft = Math.sin(Math.PI * fy) * (.7 + .6 * lattice(j, x >> 5, 2));
  return (i + j) % 2 ? warp * .85 + weft * .2 : weft * .85 + warp * .2;
}, 1.1);
// Printed paper over board: the soft tooth that survives under a laminate.
const paperNormals = () => tileNormals(128, (x, y) => {
  const octave = (cell, salt) => {
    const n = 128 / cell, gx = x / cell, gy = y / cell, i = Math.floor(gx), j = Math.floor(gy);
    const sx = (gx - i) ** 2 * (3 - 2 * (gx - i)), sy = (gy - j) ** 2 * (3 - 2 * (gy - j));
    const v = (a, b) => lattice((i + a) % n, (j + b) % n, salt);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(v(0, 0), v(1, 0), sx), THREE.MathUtils.lerp(v(0, 1), v(1, 1), sx), sy);
  };
  return octave(32, 5) * .9 + octave(8, 6) * .45 + lattice(x, y, 7) * .08;
}, 1.4);
// Swallowtail cut, measured in ribbon widths from the tip (v = 0 at the tip):
// a shallow V, a fifth of the width deep, as scissors leave it.
const ribbonNotch = () => {
  const w = 16, h = 64, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const across = Math.abs((x + .5) / w * 2 - 1), i = (y * w + x) * 4;
    data.fill((y + .5) / h > .2 * (1 - across) ? 255 : 0, i, i + 4);
  }
  return data;
};


export {clothNormals,paperNormals,ribbonNotch};
