import * as THREE from 'three';
import { createBaggebo } from './baggebo-model.js';
import { createShelfFurniture } from './shelf-furniture.js';
import { normalizeShelfType, WALNUT_SPEC } from './shelf-types.js';
import { openStudio, studioControls, SHELF_STUDIO } from './catalog-studio.js';

const WALNUT = new URL('../assets/library/walnut-pbr.webp',import.meta.url).href;
const WALNUT_SURFACE = new URL('../assets/library/walnut-surface.webp',import.meta.url).href;

/** The same cabinet geometry as the library, lit and rendered only on demand.
 * When to build, show or draw, and the studio's lights per type, are decided in Rust
 * (rust-ui/src/catalog_studio.rs). */
export function createShelfCatalogPreview(host) {
  let modelSize = null, wood, backWood, darkWood;
  const textures = [], materials = [];
  function walnutMaterials(renderer, invalidate) {
    if (wood) return { wood,backWood,darkWood };
    const loader = new THREE.TextureLoader();
    const colour = loader.load(WALNUT,invalidate), surface = loader.load(WALNUT_SURFACE,invalidate);
    colour.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [colour,surface]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
      textures.push(texture);
    }
    wood = new THREE.MeshPhysicalMaterial({ map:colour,bumpMap:surface,bumpScale:.55,roughnessMap:surface,
      vertexColors:true,color:'#ffffff',roughness:.9,clearcoat:.32,clearcoatRoughness:.36 });
    backWood = new THREE.MeshStandardMaterial({ map:colour,bumpMap:surface,bumpScale:.4,roughnessMap:surface,
      vertexColors:true,color:'#e6dccf',roughness:1,envMapIntensity:.7 });
    darkWood = new THREE.MeshPhysicalMaterial({ map:colour,bumpMap:surface,bumpScale:.5,roughnessMap:surface,
      vertexColors:true,color:'#f2e6d6',roughness:.95,clearcoat:.26,clearcoatRoughness:.4 });
    materials.push(wood,backWood,darkWood);
    return { wood,backWood,darkWood };
  }
  function removeModel(model) {
    if (!model) return;
    studio.parts.scene.remove(model);
    if (typeof model.userData.dispose === 'function') model.userData.dispose();
    else model.userData.disposeGeometry?.();
    modelSize = null;
  }
  const studio = openStudio(SHELF_STUDIO, host, {
    padding:1.14,
    // The type's lights and the cabinet's angle, centring and stated size: rust-ui/src/studio_build.rs.
    make(type, stage, previous, invalidate) {
      const { scene, renderer } = studio.parts;
      removeModel(previous);
      studio.shelf.studio_shelf_lights(studio.parts, stage);
      const model = type === 'baggebo' ? createBaggebo({ width:600 }) : createShelfFurniture({
        width:WALNUT_SPEC.width,height:WALNUT_SPEC.height,depth:WALNUT_SPEC.depth,scale:1,
        rows:WALNUT_SPEC.shelfBottoms.map(bottom => ({ bottom })),...walnutMaterials(renderer, invalidate)
      });
      studio.shelf.studio_shelf_place(THREE, host, scene, model);
      return model;
    },
    size:model => modelSize ||= new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()),
    release(model, { lights }) {
      removeModel(model);
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      lights.key?.shadow.dispose();
    }
  });
  const { state, shelf } = studio;
  return studioControls(studio, ({ shelfType }) => shelf.studio_update_shelf(state, normalizeShelfType(shelfType)));
}
