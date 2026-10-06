import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShelfPlant } from './shelf-plants.js';
import { retainPrograms, whenProgramsReady } from './gpu-programs.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';

/** One stationary front view. Render only for selection, resize or texture updates.
 * A new selection is built after the tapped choice has painted and is shown
 * once its shaders are linked in parallel; the previous plant stays meanwhile. */
export function createPlantCatalogPreview(host) {
  let renderer, environment, model, observer, frame = 0, disposed = false, active = true;
  let modelSize = null, paintedWidth = NaN, paintedHeight = NaN;
  let pending = null, building = 0, incoming = null, cancelLink = null, dirty = true;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-80,80,90,-90,1,1000);
  camera.position.set(0,0,400); camera.lookAt(0,0,0);
  const unavailable = () => {
    host.dataset.renderer = 'unavailable';
    host.textContent = 'Vista 3D no disponible';
  };
  const render = () => {
    frame = 0;
    if (disposed || !active || !renderer) return;
    // A task after this frame: the pressed choice paints before the build.
    if (pending && !building && !incoming) building = setTimeout(build);
    if (!model || !dirty) return;
    dirty = false;
    // Layout size: the page may be scaled mid-flight, its drawing buffer not.
    const rect = host.clientWidth ? { width:host.clientWidth,height:host.clientHeight } : host.getBoundingClientRect();
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
    // Going back to an earlier plant reuses its linked shaders.
    if (renderer.info) retainPrograms(renderer);
    host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
  };
  const request = () => { if (!disposed && active && !frame) frame = requestAnimationFrame(render); };
  const invalidate = () => { dirty = true; request(); };
  function build(prepare = false) {
    building = 0;
    if (disposed || (!active && !prepare) || !pending || incoming || !renderer) return;
    const selection = pending; pending = null;
    const next = incoming = createShelfPlant({ ...selection,seed:`catalog:${selection.catalogId}` });
    next.userData.invalidate = invalidate; next.visible = false; scene.add(next);
    cancelLink = whenProgramsReady(renderer,scene,camera,next,() => {
      cancelLink = null; incoming = null;
      if (model) { scene.remove(model); model.userData.dispose(); }
      model = next; model.visible = true; modelSize = null;
      host.dataset.modelCatalogId = selection.catalogId;
      invalidate();
    });
  }
  try {
    if (typeof WebGLRenderingContext === 'undefined') throw new Error('WebGL unavailable');
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    configureShaderDiagnostics(renderer);
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
      // Only the shown plant can be recoloured; a queued one is built anew.
      if (model && !pending && !incoming && nextShapeKey === shapeKey && model.userData.updatePotColor?.(selection.potColorId)) {
        selectionKey = key;
        invalidate();
        return;
      }
      selectionKey = key;
      shapeKey = nextShapeKey;
      pending = selection; request();
    },
    /** Build the queued plant and link its shaders now, even while hidden. */
    prepare() { if (building) clearTimeout(building); build(true); },
    dispose() {
      if (disposed) return; disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (building) clearTimeout(building);
      cancelLink?.(); incoming?.userData.dispose();
      observer?.disconnect(); model?.userData.dispose();
      environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      host.replaceChildren();
    }
  };
}
