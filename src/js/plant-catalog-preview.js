import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShelfPlant } from './shelf-plants.js';

/** One stationary front view. Render only for selection, resize or texture updates. */
export function createPlantCatalogPreview(host) {
  let renderer, environment, model, observer, frame = 0, disposed = false, active = true;
  let modelSize = null, paintedWidth = NaN, paintedHeight = NaN;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-80,80,90,-90,1,1000);
  camera.position.set(0,0,400); camera.lookAt(0,0,0);
  const unavailable = () => {
    host.dataset.renderer = 'unavailable';
    host.textContent = 'Vista 3D no disponible';
  };
  const render = () => {
    frame = 0;
    if (disposed || !active || !renderer || !model) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1,rect.width), height = Math.max(1,rect.height), aspect = width/height;
    // Texture completion changes the surface, never this stationary geometry.
    const size = modelSize ||= new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const half = Math.max(size.y/2,size.x/(2*aspect))*1.14;
    camera.left = -half*aspect; camera.right = half*aspect; camera.top = half; camera.bottom = -half;
    camera.updateProjectionMatrix();
    if (width !== paintedWidth || height !== paintedHeight) {
      renderer.setSize(width,height,false); paintedWidth = width; paintedHeight = height;
    }
    renderer.render(scene,camera);
    host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
  };
  const invalidate = () => { if (!disposed && active && !frame) frame = requestAnimationFrame(render); };
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
  let selectionKey, shapeKey;
  return {
    setActive(value) {
      if (disposed) return;
      const next = Boolean(value);
      host.dataset.previewActive = String(next);
      if (active === next) return;
      active = next;
      if (!active) { if (frame) cancelAnimationFrame(frame); frame = 0; }
      else invalidate(); // redraw at the current visible size even with the same selection
    },
    update(selection) {
      const key = JSON.stringify(selection);
      host.dataset.catalogId = selection.catalogId;
      host.dataset.potId = selection.potId;
      host.dataset.potColorId = selection.potColorId;
      if (!renderer || disposed || key === selectionKey) return;
      const nextShapeKey = JSON.stringify(Object.fromEntries(Object.entries(selection).filter(([name]) => name !== 'potColorId')));
      if (model && nextShapeKey === shapeKey && model.userData.updatePotColor?.(selection.potColorId)) {
        selectionKey = key;
        invalidate();
        return;
      }
      selectionKey = key;
      shapeKey = nextShapeKey;
      if (model) { scene.remove(model); model.userData.dispose(); }
      modelSize = null;
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
