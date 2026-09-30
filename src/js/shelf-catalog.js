import * as THREE from 'three';

/** A small paper catalogue clipped to the outside of the cabinet. The artwork
 * is drawn like an assembly booklet; it is a texture on real folded paper,
 * rather than an image standing in for the object. Local +Z is the cover. */
export function createShelfCatalog({ width = 76, height = 108, thickness = 3.4 } = {}) {
  const catalogue = new THREE.Group();
  catalogue.name = 'ikea-plant-catalog';
  catalogue.userData.catalog = true;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const material = options => {
    const value = new THREE.MeshStandardMaterial(options); materials.add(value); return value;
  };
  const paper = material({ color:'#fffdf0', roughness:.94 });
  const edge = material({ color:'#e5e0cf', roughness:.98 });
  const clip = material({ color:'#c8cbd0', metalness:.88, roughness:.28 });
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = Math.round(canvas.width * height / width);
  const context = canvas.getContext('2d');
  if (context?.fillRect) {
    const W = canvas.width, H = canvas.height;
    context.fillStyle = '#fffdf3'; context.fillRect(0, 0, W, H);
    // The restricted palette and ample blank paper follow the reference
    // instruction booklets. Botanical line art remains sharp on a phone.
    context.fillStyle = '#0058a3'; context.fillRect(47, 43, 198, 84);
    context.fillStyle = '#ffda1a'; context.beginPath(); context.ellipse(146, 85, 88, 34, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#0058a3'; context.font = '900 47px Arial, sans-serif'; context.textAlign = 'center';
    context.fillText('IKEA', 146, 101);
    context.textAlign = 'left'; context.fillStyle = '#151515';
    context.font = '700 58px Arial, sans-serif'; context.fillText('PLANTAS', 48, 212);
    context.font = '400 29px Arial, sans-serif'; context.fillText('Un pequeño jardín', 51, 258);
    context.strokeStyle = '#151515'; context.lineWidth = 6; context.lineJoin = 'round'; context.lineCap = 'round';
    const potY = H * .7, potX = W * .52, potWidth = W * .36, potHeight = H * .15;
    context.beginPath(); context.ellipse(potX, potY, potWidth / 2, 23, 0, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.moveTo(potX - potWidth / 2, potY); context.lineTo(potX - potWidth * .36, potY + potHeight);
    context.quadraticCurveTo(potX, potY + potHeight + 25, potX + potWidth * .36, potY + potHeight);
    context.lineTo(potX + potWidth / 2, potY); context.stroke();
    for (let index = 0; index < 5; index++) {
      const tipX = potX + (index - 2) * 75, tipY = potY - 205 - (2 - Math.abs(index - 2)) * 45;
      context.beginPath(); context.moveTo(potX + (index - 2) * 13, potY - 8);
      context.quadraticCurveTo(tipX - 57, tipY + 115, tipX, tipY);
      context.quadraticCurveTo(tipX + 53, tipY + 125, potX + (index - 2) * 13, potY - 8); context.stroke();
      context.beginPath(); context.moveTo(potX + (index - 2) * 13, potY - 8); context.lineTo(tipX, tipY + 19); context.stroke();
    }
    context.lineWidth = 3; context.beginPath(); context.moveTo(49, H - 115); context.lineTo(W - 49, H - 115); context.stroke();
    context.font = '700 30px Arial, sans-serif'; context.fillText('01', 52, H - 59);
    context.font = '400 26px Arial, sans-serif'; context.fillText('Elige · Coloca · Disfruta', 121, H - 59);
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4; textures.add(map);
  const cover = material({ color:'#ffffff', map, roughness:.83 });
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
  const front = mesh(new THREE.PlaneGeometry(width, height), cover, 'catalog-front-cover'); front.position.z = thickness / 2 + .18;
  const back = mesh(new THREE.BoxGeometry(width, height, .25), paper, 'catalog-back-cover'); back.position.z = -thickness / 2 - .18;
  const spine = mesh(new THREE.BoxGeometry(1.6, height, thickness + .65), paper, 'catalog-fold'); spine.position.x = -width / 2 + .5;
  // A folded steel clip is tangible and catches the same light as the books.
  const clasp = mesh(new THREE.BoxGeometry(18, 5, 5.4), clip, 'catalog-clip'); clasp.position.set(0, height / 2 + .6, 0);
  const pin = mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.4, 12), clip, 'catalog-wall-pin');
  pin.rotation.x = Math.PI / 2; pin.position.set(0, height / 2 + 8, -thickness / 2 - .7);
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
