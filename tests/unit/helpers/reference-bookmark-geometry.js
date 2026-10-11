// Independent pre-Rust bookmark geometry, copied before the migration.
import * as THREE from 'three';
const lattice = (i, j, salt) => {
  let h = Math.imul(i * 374761393 + j * 668265263 + salt * 1442695041 | 0, 1274126177);
  h = Math.imul(h ^ h >>> 13, 1103515245);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
};
export function referenceBookmarkGeometry(width, height, thickness, progress, peek = 10,
  { open = 0, withdraw = 0, segments = 32, seed = 0, geometry: target } = {}) {
  // Peek values belong to the 200 px shelf book, not the much larger lifted
  // copy. Keep the ribbon's physical proportions identical in both models.
  const ribbonWidth = Math.min(width * .09, Math.max(height * .035, Math.min(height * .055, thickness * .42)));
  // Each copy of a book falls the same way; different books do not.
  const vary = k => seed ? lattice(seed % 65521, k, 17) : .5;
  const visibleLength = height * Math.max(.09, Math.min(.17, (Number(peek) || 10) / 200 * 1.6))
    * (1 + (seed ? .12 * vary(1) : 0));
  const opening = Math.max(0, Math.min(1, open)), { lerp, smoothstep, clamp } = THREE.MathUtils;
  // Always between two leaves, never on a board: an unread book keeps its
  // ribbon under the first leaf instead of lying across the front cover.
  const leaves = Math.max(0, thickness / 2 - height * .0125);
  const insideDepth = clamp(thickness / 2 - thickness * Math.max(0, Math.min(1, progress)), -leaves, leaves);
  const pageDepth = thickness / 2 - height * .0083 + height * .002;
  // The leaves above the saved page lift with the board, so the ribbon is on
  // the exposed page early in the opening instead of surfacing through it.
  const depth = lerp(insideDepth, pageDepth, smoothstep(opening, 0, .3));
  // Lying down (position, roll) settles while the board still covers most of
  // the page; the end beyond the head folds over it a little later.
  const lay = smoothstep(opening, .05, .55), flop = smoothstep(opening, .15, .85);
  // Closed it rises clear of the spine; open it lies beside the gutter, in
  // the inner margin, instead of across the first words of every line.
  const x = lerp(-width / 2 + Math.max(thickness * .75, ribbonWidth * 1.5),
    -width / 2 + height * .012 + ribbonWidth * .5 + width * .006, lay);
  // Withdrawing slides the silk along its own path: up the page and over the
  // head, never straight up through the air above the book.
  const lift = height * 1.25 * Math.max(0, Math.min(1, withdraw));
  const positions = [], uvs = [], indices = [];
  const pageTop = height / 2 - height * .009, bend = height * .016;
  // The fold starts right at the edge of the leaf, so it never curls into it.
  const head = lerp(height / 2 - height * .012, pageTop - bend * .3, lay);
  const tail = lerp(height / 2 - height * .64, -height / 2 + height * .03, lay);
  const upper = visibleLength + height * .012;
  // Closed: the limp satin leans back over the head (toward the fore-edge)
  // and drifts a little aside, evenly along its length, never as a hook.
  const back = visibleLength * (.1 + .16 * vary(2)), drift = visibleLength * (vary(3) - .5) * .36;
  // Open: past the head it rolls over the edge of the text block (a quarter
  // turn of radius `bend`) and runs back along the head, out of sight.
  const arc = bend * Math.PI / 2, reachBack = pageDepth - bend - (-thickness / 2 + height * .0084);
  const steps = Math.max(4, Math.round((Number(segments) || 32) / 2) * 2), fabricDepth = height * .0018;
  // Closed, the ribbon turns toward someone looking at the binding, so from
  // the spine it shows its face; from the front it still shows a third of
  // it, never a bare thread. The turn is complete inside the text block,
  // just under its head: seen from above (the flyout looks slightly down on
  // the head) it leaves the leaves as one even strip, with no flared foot.
  const twistMax = Math.PI / 2 * (.74 + .08 * vary(4));
  const turn = s => smoothstep(s, -height * .006, height * .0025);
  // Turning about its middle would push the edge through a board at the very
  // first or last leaf: the ribbon moves inward by exactly what it gains.
  const reach = Math.sin(twistMax) * ribbonWidth / 2;
  const inward = (clamp(depth, -leaves + reach, leaves - reach) - depth) * (1 - lay);
  const bodyLength = head - tail, wander = ribbonWidth * (.12 + .1 * vary(6)), splay = ribbonWidth * .3 * vary(7);
  // `s` is the arc length past the head, negative inside the book or on the
  // page. Samples are laid on the path, not on the sliding silk: half on the
  // page, the rest from the head on, a fixed share of them crowded over the
  // turn and the fold, so no chord ever cuts under the paper while it slides.
  const start = lift - bodyLength, cut = upper + lift, split = Math.min(cut, Math.max(start, 0));
  const half = steps / 2, fold = Math.max(1, Math.round(steps * .19)), folded = Math.min(cut, split + arc * 1.1);
  const along = i => i <= half ? lerp(start, split, i / half)
    : i - half <= fold ? split + (folded - split) * ((i - half) / fold) ** 1.4
    : lerp(folded, cut, (i - half - fold) / (half - fold));
  const centre = [], twists = [], onPage = [], tucks = [];
  for (let i = 0; i <= steps; i++) {
    const s = along(i), point = new THREE.Vector3(x, head, depth), turned = twistMax * turn(s);
    // A sideways shift, kept out of the direction the cross-sections face.
    tucks.push(inward * Math.sin(turned) / (Math.sin(twistMax) || 1));
    let twist = turned * (1 - lay);
    if (s <= 0) {
      // On an open page it runs the full leaf and never lies ruler-straight.
      // The wander belongs to the page, so a sliding ribbon meets the head
      // edge exactly where it rests.
      const u = -s / bodyLength;
      point.x += lay * (wander * Math.sin(Math.PI * 1.3 * u) + splay * u * u);
      point.y += s;
      point.z += lay * height * .0012 * (1 - Math.cos(u * Math.PI * 4)) / 2;
      // Satin never lies dead flat: a slow roll turns the sheen on and off.
      twist += lay * .22 * Math.sin(u * Math.PI * 2.6 + vary(5) * 6) * (1 - (1 - u) ** 3);
    } else {
      const k = flop * Math.PI / 2 / arc, bent = Math.min(s, arc);
      // Past the gathering's depth the rest is tucked under, out of sight.
      const run = Math.min(s - bent, reachBack + (1 - flop) * height * 4);
      // A cantilever's sag: nothing at the root, most of it toward the end.
      const angle = k * bent, fall = smoothstep(Math.min(1, s / upper), 0, 1) * (1 - flop);
      point.x += back * fall;
      point.y += (k > 1e-6 ? Math.sin(angle) / k : bent) + run * Math.cos(angle);
      point.z += (k > 1e-6 ? (Math.cos(angle) - 1) / k : 0) - run * Math.sin(angle) + drift * fall;
    }
    centre.push(point); twists.push(twist); onPage.push(s <= 0);
  }
  // v measures ribbon widths back from the cut tip, where the swallowtail is.
  const fromTip = [0];
  for (let i = steps; i > 0; i--) fromTip.unshift(fromTip[0] + centre[i].distanceTo(centre[i - 1]));
  // One strip: every cross-section is square to the ribbon's own direction,
  // so the fold over the head keeps the full width and fabric thickness.
  const tangent = new THREE.Vector3(), across = new THREE.Vector3(), face = new THREE.Vector3();
  const side = new THREE.Vector3(), normal = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= steps; i++) {
    const point = centre[i], v = fromTip[i] / ribbonWidth, twist = twists[i];
    tangent.subVectors(centre[Math.min(steps, i + 1)], centre[Math.max(0, i - 1)]);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, -1); else tangent.normalize();
    across.copy(X).addScaledVector(tangent, -tangent.x).normalize();
    face.crossVectors(across, tangent);
    side.copy(across).multiplyScalar(Math.cos(twist)).addScaledVector(face, Math.sin(twist)).multiplyScalar(ribbonWidth / 2);
    normal.copy(across).multiplyScalar(-Math.sin(twist)).addScaledVector(face, Math.cos(twist)).multiplyScalar(fabricDepth / 2);
    // On the page it is raised by its own roll, so neither edge ever sinks
    // into the paper; between closed leaves it is only tucked clear of the boards.
    const z = point.z + tucks[i] + (onPage[i] ? lay * Math.abs(side.z) : 0);
    positions.push(point.x - side.x + normal.x, point.y - side.y + normal.y, z - side.z + normal.z,
      point.x + side.x + normal.x, point.y + side.y + normal.y, z + side.z + normal.z,
      point.x - side.x - normal.x, point.y - side.y - normal.y, z - side.z - normal.z,
      point.x + side.x - normal.x, point.y + side.y - normal.y, z + side.z - normal.z);
    uvs.push(0, v, 1, v, 0, v, 1, v);
    if (i < steps) {
      const k = i * 4, n = k + 4;
      indices.push(k, k + 1, n, k + 1, n + 1, n,
        k + 2, n + 2, k + 3, k + 3, n + 2, n + 3,
        k, n, k + 2, k + 2, n, n + 2,
        k + 1, k + 3, n + 1, k + 3, n + 3, n + 1);
    }
  }
  indices.push(0, 2, 1, 1, 2, 3);
  const end = steps * 4;
  indices.push(end, end + 1, end + 2, end + 1, end + 3, end + 2);
  // Opening and withdrawing only bend the ribbon; its topology stays fixed.
  // Keep the same GPU buffers during the flight instead of deleting and
  // uploading a new indexed mesh on every frame. The path and normals are
  // still calculated at the original resolution.
  const reuse = target?.getAttribute('position')?.count === positions.length / 3
    && target.getAttribute('uv')?.count === uvs.length / 2
    && target.index?.count === indices.length;
  const geometry = reuse ? target : new THREE.BufferGeometry();
  if (reuse) {
    geometry.getAttribute('position').array.set(positions);
    geometry.getAttribute('uv').array.set(uvs);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('uv').needsUpdate = true;
    geometry.boundingBox = geometry.boundingSphere = null;
  } else {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  return geometry;
}
