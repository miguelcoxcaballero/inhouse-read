import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';
import { buildNodes, makeMaterials, openPacket } from './zz-main-geo-packet.js';

/** The book travels above the open rim, then falls into the actual hollow body.
 * All positions use the same world axes as the cabinet and its shared camera. The flight's
 * arithmetic runs in Rust (rust-ui/src/shelf_trash.rs); only the Vector3 is built here. */
export function sampleTrashDrop(start, mouth, progress, { height = 200, scale = 1, endScale = .19 } = {}) {
  const [x, y, z, size, turn, fall] = needRustShelf().sample_trash_drop(start.x, start.y, start.z, mouth.x, mouth.y, mouth.z, progress, height, scale, endScale);
  return { position:start.clone().set(x, y, z), scale:size, turn, fall };
}

/** Fine orange-peel texture of a powder coat: R relief, G roughness. A tiny
 * deterministic 64px field, generated once per bin in Rust; no downloads or idle work. */
function powderCoat() {
  const size = 64, texture = new THREE.DataTexture(needRustShelf().powder_coat(), size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(12, 12);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

/** A powder-coated steel pedal bin: rolled rim, removable inner bucket,
 * moulded base with a brushed-steel pedal and a domed stainless lid on a rear
 * hinge. Opening remains the lid's rotation about its back axle. Its size, every
 * part's geometry, transform and material table come from Rust (rust-ui/src/shelf_trash.rs);
 * the host makes the three.js objects. */
export function createShelfTrash({ radius = 44, height = 140 } = {}) {
  const shelf = needRustShelf(), [size, tall, mouth] = shelf.trash_size(radius, height);
  const basket = new THREE.Group();
  basket.name = 'Shelf wastebasket';
  const peel = powderCoat(), textures = new Set([peel]);
  const packet = openPacket(shelf.trash_model(size, tall)), materials = makeMaterials(packet.header.materials, { peel });
  const lid = buildNodes(packet, materials, basket).find(object => object.isGroup);
  basket.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
  const geometries = new Set(), owned = new Set();
  basket.traverse(mesh => { if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) owned.add(mesh.material); });
  let disposed = false;
  basket.userData.trash = true;
  basket.userData.radius = size; basket.userData.height = tall;
  basket.userData.lid = lid;
  basket.userData.setState = ({ openness = 0, bounce = 0 } = {}) => {
    const [open, swing] = shelf.trash_lid_open(openness);
    lid.rotation.x = swing;
    lid.rotation.z = shelf.trash_lid_wobble(bounce);
    basket.userData.openness = open;
  };
  basket.userData.getMouth = () => new THREE.Vector3(0, mouth, 0).applyMatrix4(basket.matrixWorld);
  basket.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of owned) material.dispose();
    for (const texture of textures) texture.dispose();
  };
  basket.userData.setState();
  return basket;
}
