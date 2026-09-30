import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/** Print the cover like a real IKEA booklet: a solid brand-blue masthead with
 * the logo, a bold title and one flat-printed illustration on uncoated paper.
 * Big shapes and strong colour keep it recognisable at 25-40px on the shelf. */
function drawCover(context, W, H) {
  const u = W / 512;
  context.fillStyle = '#fbf8f0'; context.fillRect(0, 0, W, H);
  // Uncoated stock: faint fibres and a slightly warmer edge.
  let seed = 7;
  const random = () => (seed = Math.imul(seed ^ seed >>> 15, 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296;
  for (let i = 0; i < 900; i++) {
    context.fillStyle = `rgba(120, 100, 70, ${.025 + random() * .035})`;
    context.fillRect(random() * W, random() * H, (1 + random() * 3) * u, .8 * u);
  }
  const edge = context.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .75);
  edge.addColorStop(0, 'rgba(255,255,255,0)'); edge.addColorStop(1, 'rgba(150,120,80,.08)');
  context.fillStyle = edge; context.fillRect(0, 0, W, H);
  const blue = '#0058a3', yellow = '#ffda1a', ink = '#161616', font = '"Noto Sans", Verdana, Arial, sans-serif';
  // Masthead: full-bleed brand blue with the yellow oval logo.
  const band = 156 * u;
  context.fillStyle = blue; context.fillRect(0, 0, W, band);
  const lw = 212 * u, lh = 92 * u, lx = 34 * u, ly = (band - lh) / 2;
  context.fillStyle = yellow; context.beginPath(); context.ellipse(lx + lw / 2, ly + lh / 2, lw / 2, lh / 2, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = blue; context.font = `900 ${60 * u}px ${font}`; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText('IKEA', lx + lw / 2, ly + lh / 2 + 3 * u);
  context.fillStyle = yellow; context.fillRect(0, band, W, 10 * u);
  context.textAlign = 'left'; context.textBaseline = 'alphabetic';
  context.fillStyle = ink; context.font = `800 ${78 * u}px ${font}`; context.fillText('PLANTAS', 32 * u, band + 96 * u);
  context.font = `400 ${21 * u}px ${font}`; context.fillStyle = '#3c3c3c';
  context.fillText('Plantas y macetas de interior', 35 * u, band + 132 * u);
  // Flat-printed illustration: a sansevieria in a terracotta pot beside a
  // small rosette, filled in two inks with a fine keyline.
  context.lineJoin = 'round'; context.lineCap = 'round';
  const px = W * .38, py = H - 64 * u, pw = 136 * u, ph = 112 * u;
  const blades = [[-40, 160, -.24], [-16, 206, -.08], [8, 222, .03], [28, 184, .15], [48, 140, .3], [-2, 124, -.4]];
  for (const [offset, length, lean] of blades) {
    const x0 = px + offset * u, y0 = py - ph + 2 * u, tipX = x0 + Math.sin(lean) * length * u, tipY = y0 - Math.cos(lean) * length * u;
    const half = (13 + length / 34) * u;
    context.beginPath(); context.moveTo(x0 - half, y0);
    context.bezierCurveTo(x0 - half * 1.25, y0 - length * .45 * u, tipX - half * .5, tipY + length * .2 * u, tipX, tipY);
    context.bezierCurveTo(tipX + half * .5, tipY + length * .22 * u, x0 + half * 1.2, y0 - length * .4 * u, x0 + half, y0);
    context.closePath(); context.fillStyle = lean < 0 ? '#3d6f37' : '#4a8041'; context.fill();
    context.strokeStyle = '#1f3a1d'; context.lineWidth = 2.2 * u; context.stroke();
    // Pale cross bands, as on the real leaves.
    context.save(); context.clip(); context.strokeStyle = 'rgba(214, 226, 170, .55)'; context.lineWidth = 3.4 * u;
    for (let step = 1; step < 9; step++) {
      const f = step / 9, bx = x0 + (tipX - x0) * f, by = y0 + (tipY - y0) * f;
      context.beginPath(); context.moveTo(bx - half * 1.4, by + 5 * u); context.quadraticCurveTo(bx, by - 6 * u, bx + half * 1.4, by + 5 * u); context.stroke();
    }
    context.restore();
  }
  const pot = () => {
    context.beginPath(); context.moveTo(px - pw / 2, py - ph); context.lineTo(px - pw * .4, py);
    context.quadraticCurveTo(px, py + 10 * u, px + pw * .4, py); context.lineTo(px + pw / 2, py - ph); context.closePath();
  };
  pot(); context.fillStyle = '#c96f45'; context.fill();
  context.fillStyle = '#b25d38'; context.fillRect(px - pw / 2 - 4 * u, py - ph - 4 * u, pw + 8 * u, 24 * u);
  pot(); context.strokeStyle = '#4a2414'; context.lineWidth = 2.4 * u; context.stroke();
  context.strokeRect(px - pw / 2 - 4 * u, py - ph - 4 * u, pw + 8 * u, 24 * u);
  // Small rosette in a tapered pot.
  const rx = W * .79, ry = H - 70 * u;
  for (let leaf = 0; leaf < 9; leaf++) {
    const angle = -Math.PI / 2 + (leaf - 4) * .36, length = (58 - Math.abs(leaf - 4) * 4) * u;
    const bx = rx, by = ry - 62 * u, tx = bx + Math.cos(angle) * length, ty = by + Math.sin(angle) * length * .8;
    context.beginPath(); context.moveTo(bx, by);
    context.quadraticCurveTo((bx + tx) / 2 + Math.sin(angle) * 16 * u, (by + ty) / 2 - 10 * u, tx, ty);
    context.quadraticCurveTo((bx + tx) / 2 - Math.sin(angle) * 16 * u, (by + ty) / 2 + 8 * u, bx, by);
    context.fillStyle = leaf % 2 ? '#7da08c' : '#8fb39d'; context.fill();
    context.strokeStyle = '#2d4a3a'; context.lineWidth = 1.8 * u; context.stroke();
  }
  context.beginPath(); context.moveTo(rx - 44 * u, ry - 64 * u); context.lineTo(rx - 32 * u, ry); context.lineTo(rx + 32 * u, ry);
  context.lineTo(rx + 44 * u, ry - 64 * u); context.closePath();
  context.fillStyle = '#e9e4da'; context.fill(); context.strokeStyle = '#3a3a3a'; context.lineWidth = 2.2 * u; context.stroke();
  // Ground line under both pots.
  context.fillStyle = 'rgba(40, 30, 20, .16)'; context.fillRect(28 * u, H - 52 * u, W - 56 * u, 3 * u);
}

/** A saddle-stitched paper catalogue hanging from a steel bulldog clip on a
 * pin in the outside of the cabinet. The artwork is a texture on real paper
 * with thickness; local +Z is the cover, -Z faces the cabinet wall. */
export function createShelfCatalog({ width = 76, height = 108, thickness = 3.4 } = {}) {
  const catalogue = new THREE.Group();
  catalogue.name = 'ikea-plant-catalog';
  catalogue.userData.catalog = true;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const material = (options, kind = THREE.MeshStandardMaterial) => {
    const value = new kind(options); materials.add(value); return value;
  };
  const paper = material({ color:'#f7f3e8', roughness:.93 });
  const edge = material({ color:'#e9e3d3', roughness:.97 });
  const clip = material({ color:'#c3c7cb', metalness:.88, roughness:.42, clearcoat:.3, clearcoatRoughness:.22 }, THREE.MeshPhysicalMaterial);
  // 512px wide is ample for a booklet that is never more than ~180px tall.
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = Math.round(canvas.width * height / width);
  const context = canvas.getContext('2d');
  if (context?.fillRect) drawCover(context, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4; textures.add(map);
  const cover = material({ color:'#ffffff', map, roughness:.62 });
  function mesh(geometry, surface, name) {
    geometries.add(geometry);
    const item = new THREE.Mesh(geometry, surface); item.name = name;
    item.castShadow = true; item.receiveShadow = true; catalogue.add(item); return item;
  }
  const block = mesh(new THREE.BoxGeometry(width - .8, height - .8, thickness), edge, 'catalog-paper-block');
  block.position.z = -.2;
  // Four narrow inset sheets produce stepped, shaded page edges at the bottom.
  for (let index = 0; index < 4; index++) {
    const sheet = mesh(new THREE.BoxGeometry(width - index * .3, height - index * .25, .2), paper, `catalog-sheet-${index}`);
    sheet.position.set(index * .11, -index * .13, -thickness / 2 + index * thickness / 4);
  }
  // The cover is held flat by the clip and relaxes towards the free corner.
  const coverGeometry = new THREE.PlaneGeometry(width, height, 8, 10), position = coverGeometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) / width + .5, y = position.getY(i) / height + .5;
    position.setZ(i, (1 - y) ** 2 * .45 + x ** 3 * (1 - y) ** 3 * 1.5 + Math.sin(x * Math.PI) * .12);
  }
  coverGeometry.computeVertexNormals();
  const front = mesh(coverGeometry, cover, 'catalog-front-cover'); front.position.z = thickness / 2 + .18;
  const back = mesh(new THREE.BoxGeometry(width, height, .25), paper, 'catalog-back-cover'); back.position.z = -thickness / 2 - .18;
  // Saddle-stitched fold: a rounded spine rather than a square block.
  const spine = mesh(new THREE.CylinderGeometry((thickness + .6) / 2, (thickness + .6) / 2, height, 10, 1, false, Math.PI, Math.PI), paper, 'catalog-fold');
  spine.position.x = -width / 2 + .2; spine.scale.x = .55;
  // Bulldog clip: a bent steel jaw across the top edge and two folded wire
  // handles whose loop hangs on the pin. Two staples show on the fold.
  const jawWidth = Math.min(width * .3, 24), gap = thickness / 2 + .45, sheet = .32, top = height / 2;
  const line = [[gap, -7], [gap + 1.1, -4.6], [gap + 2.3, -1.4], [gap + 1.6, 1.8], [0, 3.3], [-gap - 1.6, 1.8], [-gap - 2.3, -1.4], [-gap - 1.1, -4.6], [-gap, -7]];
  const outline = [...line.map(([z, y], index) => {
    const [z0, y0] = line[Math.max(0, index - 1)], [z1, y1] = line[Math.min(line.length - 1, index + 1)], length = Math.hypot(z1 - z0, y1 - y0);
    return [z + (y1 - y0) / length * sheet, y - (z1 - z0) / length * sheet];
  }), ...line.map(([z, y], index) => {
    const [z0, y0] = line[Math.max(0, index - 1)], [z1, y1] = line[Math.min(line.length - 1, index + 1)], length = Math.hypot(z1 - z0, y1 - y0);
    return [z - (y1 - y0) / length * sheet, y + (z1 - z0) / length * sheet];
  }).reverse()];
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const bent = new THREE.ExtrudeGeometry(shape, { depth:jawWidth, bevelEnabled:true, bevelThickness:.2, bevelSize:.08, bevelSegments:1, curveSegments:2 });
  bent.rotateY(-Math.PI / 2); bent.translate(jawWidth / 2, top + .6, 0);
  // Smooth across the gentle bends of the spring steel, crisp at its cut ends,
  // so the jaw shades as one curved sheet instead of light and dark stripes.
  const jaw = toCreasedNormals(bent, Math.PI / 4); bent.dispose();
  const pinY = top + 13.5, loop = (z, spread) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-jawWidth / 2 + .6, top + 3, z * .4), new THREE.Vector3(-jawWidth * spread, top + 7.5, z),
    new THREE.Vector3(-jawWidth * .18, pinY + .3, z), new THREE.Vector3(0, pinY + 1.1, z * .8), new THREE.Vector3(jawWidth * .18, pinY + .3, z),
    new THREE.Vector3(jawWidth * spread, top + 7.5, z), new THREE.Vector3(jawWidth / 2 - .6, top + 3, z * .4)]), 22, .38, 5, false);
  const fold = -width / 2 + .2 - (thickness + .6) / 2 * .55;
  const staples = [-.27, .27].map(offset => {
    const staple = new THREE.BoxGeometry(.3, height * .09, .3); staple.translate(fold, offset * height, 0); return staple;
  });
  const parts = [jaw, loop(-.5, .44), loop(.5, .4), ...staples].map(part => part.index ? part.toNonIndexed() : part);
  const clipGeometry = mergeGeometries(parts.map(part => { for (const key of Object.keys(part.attributes)) if (!['position', 'normal', 'uv'].includes(key)) part.deleteAttribute(key); return part; }), false);
  for (const part of parts) part.dispose();
  mesh(clipGeometry, clip, 'catalog-clip');
  // A round-headed steel pin driven into the cabinet side.
  const pinProfile = [[0, -3.2], [.45, -3.2], [.45, 1.1], [1.7, 1.2], [1.8, 1.55], [1.4, 2.1], [.7, 2.35], [0, 2.4]].map(([r, y]) => new THREE.Vector2(r, y));
  const pin = mesh(new THREE.LatheGeometry(pinProfile, 14), clip, 'catalog-wall-pin');
  pin.rotation.x = Math.PI / 2; pin.position.set(0, pinY, 0);
  catalogue.userData.bounds = new THREE.Box3().setFromObject(catalogue);
  catalogue.userData.width = width; catalogue.userData.height = height; catalogue.userData.thickness = thickness;
  let disposed = false;
  catalogue.userData.dispose = () => {
    if (disposed) return; disposed = true;
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
    for (const value of textures) value.dispose();
  };
  return catalogue;
}
