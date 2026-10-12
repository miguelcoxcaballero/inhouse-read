import * as THREE from 'three';
const BAGGEBO_SPEC={meshPitch:{width:13.2,height:7.2}},PERIOD_X=26.4,PERIOD_Y=7.2,STRAND_WIDTH=.9,SHEET_THICKNESS=.65;
export function expandedMetal(uMin, uMax, vMin, vMax, toPosition) {
  const pitch = BAGGEBO_SPEC.meshPitch.width, halfHeight = PERIOD_Y / 2;
  const outer = pitch * .6, shoulder = pitch * .4;
  const corners = [[-outer, 0], [-shoulder, -halfHeight], [shoulder, -halfHeight],
    [outer, 0], [shoulder, halfHeight], [-shoulder, halfHeight]];
  const segments = new Map();
  const key = (u, v) => `${Math.round(u * 1000)},${Math.round(v * 1000)}`;
  const addSegment = (au, av, bu, bv) => {
    const a = key(au, av), b = key(bu, bv);
    segments.set(a < b ? `${a}:${b}` : `${b}:${a}`, [au, av, bu, bv]);
  };
  for (let row = Math.floor(vMin / PERIOD_Y) - 1; row <= Math.ceil(vMax / PERIOD_Y) + 1; row += 1) {
    for (let column = Math.floor(uMin / PERIOD_X) - 1; column <= Math.ceil(uMax / PERIOD_X) + 1; column += 1) {
      for (const [offsetU, offsetV] of [[0, 0], [pitch, halfHeight]]) {
        const u = column * PERIOD_X + offsetU, v = row * PERIOD_Y + offsetV;
        for (let edge = 0; edge < corners.length; edge += 1) {
          const a = corners[edge], b = corners[(edge + 1) % corners.length];
          addSegment(u + a[0], v + a[1], u + b[0], v + b[1]);
        }
      }
    }
  }
  // The cut edge sits inside the folded perimeter. Finishing it here also
  // makes the nominal sheet size independent of where an aperture is cut.
  addSegment(uMin, vMin, uMax, vMin); addSegment(uMax, vMin, uMax, vMax);
  addSegment(uMax, vMax, uMin, vMax); addSegment(uMin, vMax, uMin, vMin);

  const positions = [], uvs = [];
  const point = (u, v, normal) => [Math.max(uMin, Math.min(uMax, u)), Math.max(vMin, Math.min(vMax, v)), normal];
  const triangle = (a, b, c) => {
    for (const vertex of [a, b, c]) {
      positions.push(...toPosition(...vertex));
      uvs.push(vertex[0] / 8, vertex[1] / 8);
    }
  };
  for (const [au, av, bu, bv] of segments.values()) {
    const du = bu - au, dv = bv - av;
    // Liang–Barsky clips strands at the cut sheet boundary, without stretched
    // triangles or the repeating alpha texture's fuzzy edges at close zoom.
    let from = 0, to = 1;
    let clipped = false;
    for (const [direction, distance] of [[-du, au - uMin], [du, uMax - au], [-dv, av - vMin], [dv, vMax - av]]) {
      if (Math.abs(direction) < 1e-9) { if (distance < 0) { clipped = true; break; } continue; }
      const ratio = distance / direction;
      if (direction < 0) from = Math.max(from, ratio); else to = Math.min(to, ratio);
      if (from >= to) { clipped = true; break; }
    }
    if (clipped) continue;
    const length = Math.hypot(du, dv), nu = -dv / length * STRAND_WIDTH / 2, nv = du / length * STRAND_WIDTH / 2;
    const u0 = au + du * from, v0 = av + dv * from, u1 = au + du * to, v1 = av + dv * to;
    const leftA = point(u0 + nu, v0 + nv, -SHEET_THICKNESS), ridgeA = point(u0, v0, 0), rightA = point(u0 - nu, v0 - nv, -SHEET_THICKNESS);
    const leftB = point(u1 + nu, v1 + nv, -SHEET_THICKNESS), ridgeB = point(u1, v1, 0), rightB = point(u1 - nu, v1 - nv, -SHEET_THICKNESS);
    if (Math.abs(dv) < 1e-7) {
      // The short connecting bonds are flattened by the expanding process;
      // one inclined face is enough here, while the stretched strands have
      // two facets. This saves a third of the bond vertices on mobile.
      leftA[2] = leftB[2] = 0;
      triangle(leftA, rightA, rightB); triangle(leftA, rightB, leftB);
    } else {
      triangle(leftA, ridgeA, ridgeB); triangle(leftA, ridgeB, leftB);
      triangle(ridgeA, rightA, rightB); triangle(ridgeA, rightB, ridgeB);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

