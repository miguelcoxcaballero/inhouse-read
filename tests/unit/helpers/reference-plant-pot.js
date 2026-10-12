import * as THREE from 'three';
const FOOT=.07,RIM=.6,SOIL=.74;
const clamp01=value=>Math.min(1,Math.max(0,value));
const smoothstep=(a,b,value)=>{const t=clamp01((value-a)/(b-a));return t*t*(3-2*t);};
export function potProfile(potId) {
  if (potId === 'muskot') {
    // Broad lower horizontal bands, as on the real white MUSKOT.
    const profile = [[.76,0],[.80,.025]];
    for (let i = 0; i <= 20; i++) {
      const y = .04 + i / 20 * .54;
      profile.push([.81 + y * .20 + .019 * Math.sin(i * Math.PI / 2), y]);
    }
    return [...profile, [.975,.90],[.994,.955],[.998,.984],[.986,.999],[.963,.998],[.949,.979],[.936,.94],[.922,.84],[0,.84]];
  }
  if (potId === 'gradvis') return [[.53,0],[.64,.025],[.76,.08],[.86,.16],[.93,.27],[.97,.39],[.99,.54],[1,.95],[.997,.985],[.982,1],[.955,.998],[.942,.975],[.935,.84],[0,.84]];
  if (potId === 'akerbar') return [[.78,0],[.81,.015],[.81,.035],[.785,.048],[.79,.085],[.97,.95],[1,.971],[1.018,.99],[1,1.011],[.98,1.014],[.96,1],[.957,.983],[.955,.95],[.948,.84],[0,.84]];
  // Terracotta: tapered body under a thick, rounded collar.
  return [[.68,0],[.715,.012],[.735,.05],[.895,.785],[.93,.80],[.985,.815],[1.005,.84],[1.012,.90],[1.008,.965],[.992,.992],[.965,1],[.935,.994],[.918,.965],[.912,.9],[.905,.84],[0,.84]];
}

export function potGeometry(potId, radius, height, soilFraction) {
  const rawProfile = potProfile(potId), fullHeight = Math.max(...rawProfile.map(([,y]) => y));
  const profile = rawProfile.map(([r,y]) => [r,y/fullHeight]), n = profile.length, fluted = potId === 'gradvis';
  // `radius` is the pot's real outer radius: its widest point (a rolled rim, or
  // the crest of a rib) reaches exactly that, whatever the profile's own units.
  radius /= Math.max(...profile.map(([r]) => r)) + (fluted ? .018 : 0);
  const segments = fluted ? 96 : potId === 'muskot' ? 40 : 48;
  const geometry = new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r * radius, y * height)), segments);
  const s = [0];
  for (let j = 1; j < n; j++) s.push(s[j - 1] + Math.hypot((profile[j][0] - profile[j - 1][0]) * radius, (profile[j][1] - profile[j - 1][1]) * height));
  let top = 0;
  for (let j = 1; j < n; j++) if (profile[j][1] > profile[top][1]) top = j;
  const cross = (start, end, y) => {
    for (let j = start; j < end; j++) {
      const [ra, ya] = profile[j], [rb, yb] = profile[j + 1];
      if (ya !== yb && (ya - y) * (yb - y) <= 0) { const t = (y - ya) / (yb - ya); return { s:s[j] + (s[j + 1] - s[j]) * t, r:ra + (rb - ra) * t }; }
    }
    return { s:s[end], r:profile[end][0] };
  };
  // Arc length anchors keep the unglazed foot, lip and soil line in the same
  // texture rows whatever the pot's proportions.
  const foot = cross(0, top, .04), soil = cross(top, n - 1, soilFraction);
  const anchors = [[0,0],[foot.s,FOOT],[s[top],RIM],[soil.s,SOIL],[s[n - 1],1]];
  const rowFor = value => {
    for (let k = 1; k < anchors.length; k++) if (value <= anchors[k][0] || k === anchors.length - 1) {
      const [s0,v0] = anchors[k - 1], [s1,v1] = anchors[k];
      return v0 + (v1 - v0) * (s1 > s0 ? clamp01((value - s0) / (s1 - s0)) : 0);
    }
    return 1;
  };
  const uv = geometry.attributes.uv, position = geometry.attributes.position, colors = new Float32Array(position.count * 3).fill(1);
  const lip = profile[top][1];
  for (let i = 0; i <= segments; i++) for (let j = 0; j < n; j++) {
    const index = i * n + j, [r, y] = profile[j];
    uv.setY(index, rowFor(s[j]));
    let tone = 1;
    // The inside of the pot falls into shadow towards the soil.
    if (j > top) tone = y < soilFraction - .01 ? .42 : 1 - .45 * smoothstep(0, 1, (lip - y) / (lip - soilFraction));
    else if (potId === 'muskot' && j > 0 && j < top) tone += THREE.MathUtils.clamp((r - (profile[j - 1][0] + profile[j + 1][0]) / 2) * 5, -.09, .02);
    if (fluted && j < top) {
      const x = position.getX(index), z = position.getZ(index), px = Math.hypot(x, z), rib = -Math.cos(Math.atan2(x, z) * 32);
      // Rounded vertical ribs fade into the foot and stop below the rim.
      const fade = Math.sin(Math.min(1, y * 7) * Math.PI / 2) * THREE.MathUtils.clamp((.97 - y) * 14, 0, 1);
      const offset = rib * radius * .018 * fade;
      if (px) position.setXYZ(index, x / px * (px + offset), position.getY(index), z / px * (px + offset));
      tone *= 1 + Math.min(0, rib) * .07 * fade;
    }
    colors[index * 3] = colors[index * 3 + 1] = colors[index * 3 + 2] = tone;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (fluted) {
    geometry.computeVertexNormals();
    // Weld the lathe seam so the first rib is not shaded as a hard edge.
    const normal = geometry.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      a.fromBufferAttribute(normal, j).add(b.fromBufferAttribute(normal, segments * n + j)).normalize();
      normal.setXYZ(j, a.x, a.y, a.z); normal.setXYZ(segments * n + j, a.x, a.y, a.z);
    }
  }
  return { geometry, soilRadius:soil.r * radius, radius };
}
