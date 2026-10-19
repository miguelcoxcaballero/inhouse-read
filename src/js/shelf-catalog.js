import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';
import { buildNodes, openPacket } from './geo-packet.js';

/** A saddle-stitched paper catalogue hanging from a steel bulldog clip on a
 * pin in the outside of the cabinet. The artwork is a texture on real paper
 * with thickness; local +Z is the cover, -Z faces the cabinet wall. The cover art,
 * every part's geometry, transform and the material table come from Rust
 * (rust-ui/src/shelf_catalog.rs); the host makes the canvas and the three.js objects. */
export function createShelfCatalog({ width = 76, height = 108, thickness = 3.4 } = {}) {
  const shelf = needRustShelf();
  const catalogue = new THREE.Group();
  catalogue.name = 'ikea-plant-catalog';
  catalogue.userData.catalog = true;
  const packet = openPacket(shelf.catalog_model(width, height, thickness)), materials = {};
  const textures = new Set(), roles = packet.header.materials;
  const material = ({ role, class:kind, options }) => { materials[role] = new THREE[kind](options); };
  roles.slice(0, 3).forEach(material);
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = shelf.catalog_canvas_size(width, height);
  const context = canvas.getContext('2d');
  if (context?.fillRect) shelf.catalog_draw_cover(context, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4; textures.add(map);
  material({ ...roles[3], options:{ ...roles[3].options, map } });
  for (const item of buildNodes(packet, materials, catalogue)) { item.castShadow = true; item.receiveShadow = true; }
  catalogue.userData.bounds = new THREE.Box3().setFromObject(catalogue);
  catalogue.userData.width = width; catalogue.userData.height = height; catalogue.userData.thickness = thickness;
  let disposed = false;
  catalogue.userData.dispose = () => {
    if (disposed) return; disposed = true;
    for (const item of catalogue.children) item.geometry.dispose();
    for (const value of Object.values(materials)) value.dispose();
    for (const value of textures) value.dispose();
  };
  return catalogue;
}
