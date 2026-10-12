// Frozen cactus mesh from 1.7.150.
import * as THREE from 'three';
const smoothstep=(a,b,value)=>{const t=Math.min(1,Math.max(0,(value-a)/(b-a)));return t*t*(3-2*t);};
function cactusCap(f) {
  const end = f < .15 ? f / .15 - 1 : f > .85 ? (f - .85) / .15 : 0;
  return Math.sqrt(Math.max(0, 1 - end * end));
}

export function cactusGeometry(length, radius, bend, random) {
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
