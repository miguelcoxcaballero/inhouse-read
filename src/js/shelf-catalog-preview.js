import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createBaggebo } from './baggebo-model.js';
import { createShelfFurniture } from './shelf-furniture.js';
import { normalizeShelfType } from './shelf-types.js';

const WALNUT = new URL('../assets/library/walnut-pbr.webp',import.meta.url).href;
const WALNUT_SURFACE = new URL('../assets/library/walnut-surface.webp',import.meta.url).href;

/** The same cabinet geometry as the library, lit and rendered only on demand. */
export function createShelfCatalogPreview(host) {
  let renderer, environment, model, observer, frame = 0, disposed = false, selected;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-400,400,640,-640,1,5000);
  camera.position.set(0,0,2500); camera.lookAt(0,0,0);
  const textures = [], materials = [];
  const unavailable = () => {
    host.dataset.renderer = 'unavailable'; host.textContent = 'Vista 3D no disponible';
  };
  function render() {
    frame = 0;
    if (disposed || !renderer || !model) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1,rect.width), height = Math.max(1,rect.height), aspect = width / height;
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const half = Math.max(size.y / 2,size.x / (2 * aspect)) * 1.14;
    camera.left = -half * aspect; camera.right = half * aspect;
    camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
    renderer.setSize(width,height,false); renderer.render(scene,camera);
  }
  function invalidate() {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  function removeModel() {
    if (!model) return;
    scene.remove(model);
    if (typeof model.userData.dispose === 'function') model.userData.dispose();
    else model.userData.disposeGeometry?.();
    model = null;
  }
  let wood, backWood, darkWood;
  function walnutMaterials() {
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
  try {
    if (typeof WebGLRenderingContext === 'undefined') throw new Error('WebGL unavailable');
    renderer = new THREE.WebGLRenderer({ antialias:true,alpha:true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
    renderer.domElement.setAttribute('aria-hidden','true');
    renderer.domElement.addEventListener('webglcontextlost',event => {
      event.preventDefault(); if (!disposed) unavailable();
    });
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    environment = pmrem.fromScene(room,.04); room.dispose(); pmrem.dispose();
    scene.environment = environment.texture; scene.environmentIntensity = .55;
    scene.add(new THREE.HemisphereLight('#fffaf3','#7b8190',.8));
    const key = new THREE.DirectionalLight('#fff7ec',2.4); key.position.set(-750,1200,1000); scene.add(key);
    const fill = new THREE.DirectionalLight('#e7efff',.6); fill.position.set(700,200,800); scene.add(fill);
    host.replaceChildren(renderer.domElement); host.dataset.renderer = 'three-mesh';
    observer = new ResizeObserver(invalidate); observer.observe(host);
  } catch {
    renderer?.dispose(); renderer = null; environment?.dispose(); environment = null; unavailable();
  }
  return {
    update({ shelfType }) {
      const type = normalizeShelfType(shelfType);
      host.dataset.shelfType = type;
      if (disposed || !renderer || selected === type) return;
      selected = type; removeModel();
      model = type === 'baggebo' ? createBaggebo({ width:600 }) : createShelfFurniture({
        width:600,height:1160,depth:250,rows:[{ bottom:370 },{ bottom:705 },{ bottom:1035 }],...walnutMaterials()
      });
      // A near-front angle reveals the shallow depth and perforations while
      // retaining an easy comparison of the two furniture silhouettes.
      model.rotation.set(.075,-.28,0);
      const bounds = new THREE.Box3().setFromObject(model);
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      scene.add(model);
      host.dataset.modelWidth = '600';
      host.dataset.modelDepth = '250'; host.dataset.modelHeight = '1160';
      host.dataset.material = type === 'baggebo' ? 'white-powder-coated-steel' : 'walnut';
      invalidate();
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect(); removeModel();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      host.replaceChildren();
    }
  };
}
