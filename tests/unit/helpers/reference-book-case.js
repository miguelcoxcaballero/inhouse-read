// Frozen copy of the case geometry of src/js/book-model.js before it moved to Rust (rust-ui/src/book_case.rs):
// boardGeometry, capGeometry and the split of the front board's cover faces in createBookModel, verbatim.
// The differential test compares the Rust module against these, byte for byte.
import * as THREE from 'three';

/** Half-ellipse end of the case. Close-up copies leave the hollow open so the
 * headband is visible inside a thin rim of cloth and board. */
export function referenceCapGeometry(width, thickness, segments, rim = 0) {
  const shape = new THREE.Shape(), bulge = thickness * .38;
  shape.moveTo(-width / 2, -thickness / 2);
  for (let i = 1; i <= segments; i++) {
    const a = i / segments * Math.PI;
    shape.lineTo(-width / 2 - bulge * Math.sin(a), -thickness / 2 * Math.cos(a));
  }
  if (rim) for (let i = segments; i >= 0; i--) {
    const a = i / segments * Math.PI;
    shape.lineTo(-width / 2 - (bulge - rim) * Math.sin(a), -(thickness / 2 - rim) * Math.cos(a));
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// Rounded board edges, with front/back UVs in the same coordinates as a cover.
// The bevel stays inside the book dimensions so the shelf and flyout match.
export function referenceBoardGeometry(width, height, depth, { shelf = false, overview = false } = {}) {
  // A visibly rounded, slightly softened board edge, as covered board has.
  const bevel = Math.min(depth * .4, height * .0035);
  const x = -width / 2 + bevel, y = -height / 2 + bevel;
  const w = width - bevel * 2, h = height - bevel * 2, r = height * .006;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: shelf || overview ? 1 : 3, steps: 1, curveSegments: overview ? 1 : shelf ? 2 : 5
  });
  g.translate(0, 0, -depth / 2 + bevel);
  const positions = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (const face of g.groups.filter(item => item.materialIndex === 0)) {
    for (let i = face.start; i < face.start + face.count; i++) {
      uv.setXY(i, positions.getX(i) / width + .5, positions.getY(i) / height + .5);
    }
  }
  return g;
}

/** createBookModel's front board: the same board, its cover faces split into outside (0) and inside (2). */
export function referenceFrontBoard(width, height, board, { shelf = false, overview = false } = {}) {
  const frontGeometry = referenceBoardGeometry(width, height, board, { shelf, overview });
  const frontGroups = [...frontGeometry.groups];
  frontGeometry.clearGroups();
  for (const face of frontGroups) {
    if (face.materialIndex !== 0) { frontGeometry.addGroup(face.start, face.count, face.materialIndex); continue; }
    const normal = frontGeometry.getAttribute('normal');
    let start = face.start, material = normal.getZ(start) < 0 ? 2 : 0;
    for (let index = face.start + 3; index < face.start + face.count; index += 3) {
      const nextMaterial = normal.getZ(index) < 0 ? 2 : 0;
      if (nextMaterial !== material) {
        frontGeometry.addGroup(start, index - start, material); start = index; material = nextMaterial;
      }
    }
    frontGeometry.addGroup(start, face.start + face.count - start, material);
  }
  return frontGeometry;
}
