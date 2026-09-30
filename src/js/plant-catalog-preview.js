import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShelfPlant } from './shelf-plants.js';

/** One stationary front view. Render only for selection, resize or texture updates. */
export function createPlantCatalogPreview(host) {
  let renderer, environment, model, observer, frame = 0, disposed = false;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-80,80,90,-90,1,1000);
  camera.position.set(0,0,400); camera.lookAt(0,0,0);
  const unavailable = () => {
    host.dataset.renderer = 'unavailable';
    host.textContent = 'Vista 3D no disponible';
  };
  const render = () => {
    frame = 0;
    if (disposed || !renderer || !model) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1,rect.width), height = Math.max(1,rect.height), aspect = width/height;
    const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
    const half = Math.max(size.y/2,size.x/(2*aspect))*1.14;
    camera.left = -half*aspect; camera.right = half*aspect; camera.top = half; camera.bottom = -half;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false); renderer.render(scene,camera);
  };
  const invalidate = () => { if (!disposed && !frame) frame = requestAnimationFrame(render); };
  try {
    if (typeof WebGLRenderingContext === 'undefined') throw new Error('WebGL unavailable');
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute('aria-hidden','true');
    renderer.domElement.addEventListener('webglcontextlost',event => { event.preventDefault(); if (!disposed) unavailable(); });
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    environment = pmrem.fromScene(room,.04); room.dispose(); pmrem.dispose();
    scene.environment = environment.texture; scene.environmentIntensity = .65;
    scene.add(new THREE.HemisphereLight('#fff8ee','#817c70',1.8));
    const key = new THREE.DirectionalLight('#fff4e3',3); key.position.set(-90,140,180); scene.add(key);
    const fill = new THREE.DirectionalLight('#e7efff',1.2); fill.position.set(100,40,140); scene.add(fill);
    host.replaceChildren(renderer.domElement); host.dataset.renderer = 'three-mesh';
    observer = new ResizeObserver(invalidate); observer.observe(host);
  } catch {
    renderer?.dispose(); renderer = null; environment?.dispose(); environment = null;
    unavailable();
  }
  let selectionKey;
  return {
    update(selection) {
      const key = JSON.stringify(selection);
      host.dataset.catalogId = selection.catalogId;
      host.dataset.potId = selection.potId;
      host.dataset.potColorId = selection.potColorId;
      if (!renderer || disposed || key === selectionKey) return;
      selectionKey = key;
      if (model) { scene.remove(model); model.userData.dispose(); }
      model = createShelfPlant({ ...selection,seed:`catalog:${selection.catalogId}` });
      model.userData.invalidate = invalidate; scene.add(model); invalidate();
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect(); model?.userData.dispose();
      environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      host.replaceChildren();
    }
  };
}
