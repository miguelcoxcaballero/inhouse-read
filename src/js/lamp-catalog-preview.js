import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShelfLamp } from './shelf-lamps.js';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { createShelfLampLighting, ensureAreaLights } from './shelf-lamp-lighting.js';
import { DEFAULT_LAMP_KELVIN, createTintTransition, tintColor } from './lamp-kelvin.js';
import { retainPrograms, whenProgramsReady } from './gpu-programs.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';

// The filament lamp's light needs its lookup tables before the first preview.
await ensureAreaLights().catch(() => {});

/** The actual shelf lamp, with its own warm light and reflected studio lighting. */
export function createLampCatalogPreview(host) {
  let renderer, environment, model, observer, fixture, target, filamentLighting, frame = 0, disposed = false, active = true, selected;
  let paintedWidth = NaN, paintedHeight = NaN;
  // The chosen lamp is built after its button has painted; until its shaders
  // are linked (in parallel) the canvas keeps showing the previous picture.
  // The light's colour temperature eases in ~300 ms; only colours change.
  const tint = createTintTransition(DEFAULT_LAMP_KELVIN);
  let shownTint = '';
  let pending = null, building = 0, cancelLink = null, shown = false, dirty = true;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-160,160,180,-180,1,5000);
  const display = new THREE.Group(); scene.add(display);
  const presentation = new THREE.Group(); display.add(presentation);
  const surfaces = [];
  let size = new THREE.Vector3(180,280,180);
  const unavailable = () => {
    host.dataset.renderer = 'unavailable'; host.textContent = 'Vista 3D no disponible';
  };
  function render() {
    frame = 0;
    if (disposed || !active || !renderer) return;
    if (pending && !building) building = setTimeout(build);
    const tinting = model && shown ? tint.advance(performance.now()) : false;
    if (model && shown && tint.state.value.join() !== shownTint) { applyTint(); dirty = true; }
    if (!model || !shown || !dirty) return;
    dirty = false;
    // Layout size: the page may be scaled mid-flight, its drawing buffer not.
    const rect = host.clientWidth ? { width:host.clientWidth,height:host.clientHeight } : host.getBoundingClientRect();
    const width = Math.max(1,rect.width), height = Math.max(1,rect.height), aspect = width / height;
    const half = Math.max(size.y / 2,size.x / (2 * aspect)) * 1.13;
    camera.left = -half * aspect; camera.right = half * aspect;
    camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
    filamentLighting?.update([{ kind:'lamp',key:'catalog-filaments',model,width:size.x }]);
    if (width !== paintedWidth || height !== paintedHeight) {
      renderer.setSize(width,height,false); paintedWidth = width; paintedHeight = height;
    }
    renderer.render(scene,camera);
    // Going back to an earlier lamp reuses its linked shaders.
    if (renderer.info) retainPrograms(renderer);
    host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
    if (tinting) request();
  }
  function applyTint() {
    shownTint = tint.state.value.join();
    model.userData.setTint(tint.state.value);
    if (fixture) tintColor(fixture.color.set(model.userData.lightEmitter.color),tint.state.value);
  }
  function request() {
    if (!disposed && active && !frame) frame = requestAnimationFrame(render);
  }
  function invalidate() { dirty = true; request(); }
  function removeModel() {
    filamentLighting?.dispose(); filamentLighting = null;
    if (model) {
      display.remove(model);
      (model.dispose || model.userData.dispose)?.(); model = null;
    }
    if (fixture) { display.remove(fixture); fixture.dispose(); fixture = null; }
    if (target) { display.remove(target); target = null; }
    presentation.clear();
    for (const mesh of surfaces.splice(0)) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }
  function surface(geometry,colour) {
    const mesh = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({ color:colour,roughness:.86 }));
    mesh.receiveShadow = true; surfaces.push(mesh); presentation.add(mesh); return mesh;
  }
  function build() {
    building = 0;
    if (disposed || !active || !pending) return;
    const lamp = pending; pending = null;
    cancelLink?.(); cancelLink = null; shown = false;
    removeModel(); display.position.set(0,0,0);
    renderer.shadowMap.needsUpdate = true;
    model = createShelfLamp({ lampId:lamp.id,width:lamp.dimensions.width,quality:'high',kelvin:tint.state.kelvin });
    shownTint = '';
    model.userData.invalidate = invalidate;
    model.traverse(object => {
      if (!object.isMesh) return;
      // Glass keeps the model's transparent shadow behaviour, so the
      // chimney cannot cast an opaque silhouette over its own LED filament.
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      if (objectMaterials.some(material => material.transparent || material.transmission > 0)) object.castShadow = false;
      for (const material of objectMaterials) {
        for (const name of ['map','bumpMap','roughnessMap']) {
          if (material[name]) material[name].anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
        }
      }
    });
    display.add(model);
    const emitter = model.userData.lightEmitter;
    if (emitter?.filaments) {
      emitter.intensity *= .4; // Same studio exposure as the former bulb light.
      filamentLighting = createShelfLampLighting(scene, { maxLights:1 });
    } else if (emitter) {
      fixture = emitter.direction
        ? new THREE.SpotLight(emitter.color,emitter.intensity * .55,emitter.distance,emitter.angle,emitter.penumbra,emitter.decay)
        : new THREE.PointLight(emitter.color,emitter.intensity * .4,emitter.distance,emitter.decay);
      fixture.position.fromArray(emitter.position); display.add(fixture);
      if (emitter.direction) {
        target = new THREE.Object3D(); target.position.copy(fixture.position).add(new THREE.Vector3().fromArray(emitter.direction));
        display.add(target); fixture.target = target;
      }
    }
    if (lamp.mount === 'undershelf') {
      // A short ceiling section makes the mounting and downward warm pool
      // legible; the fixture geometry itself is shared with the bookshelf.
      const board = surface(new THREE.BoxGeometry(lamp.dimensions.width * 2.1,4,lamp.dimensions.width * 1.65),'#dbd1bc');
      board.position.y = 2; board.castShadow = true;
      const below = surface(new THREE.CircleGeometry(lamp.dimensions.width * .85,64),'#e6dfd0');
      below.rotation.x = -Math.PI / 2; below.position.y = -lamp.dimensions.width * 1.35;
      camera.position.set(0,-230,650);
    } else {
      const base = surface(new THREE.CircleGeometry(lamp.dimensions.width * .82,64),'#e6dfd3');
      base.rotation.x = -Math.PI / 2; base.position.y = -.2;
      camera.position.set(0,75,850);
    }
    const bounds = new THREE.Box3().setFromObject(display);
    size = bounds.getSize(new THREE.Vector3()); display.position.sub(bounds.getCenter(new THREE.Vector3()));
    camera.lookAt(0,0,0);
    host.dataset.lightEmitter = emitter ? 'warm-physical' : 'none';
    // Its light must exist before linking: every lit program depends on it.
    display.updateMatrixWorld(true);
    applyTint();
    filamentLighting?.update([{ kind:'lamp',key:'catalog-filaments',model,width:size.x }]);
    cancelLink = whenProgramsReady(renderer,scene,camera,display,() => {
      cancelLink = null; shown = true; invalidate();
    });
  }
  try {
    if (typeof WebGLRenderingContext === 'undefined') throw new Error('WebGL unavailable');
    renderer = new THREE.WebGLRenderer({ antialias:true,alpha:true });
    configureShaderDiagnostics(renderer);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Main-camera resize and reopening do not move these stationary casters.
    renderer.shadowMap.autoUpdate = false;
    renderer.domElement.setAttribute('aria-hidden','true');
    renderer.domElement.addEventListener('webglcontextlost',event => {
      event.preventDefault(); if (!disposed) unavailable();
    });
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    // Photographing clear glass needs dark cards beside the bright softboxes.
    // These panels exist only in the reflected environment; the catalogue
    // background and the actual chimney geometry remain transparent.
    const cardMaterial = new THREE.MeshBasicMaterial({ color:'#252a30',side:THREE.DoubleSide });
    for (const [x,y,z,width,height] of [[-5,2,3,1.8,8],[5,2.5,-2,2.1,9],[0,2,-7,3,8]]) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(width,height),cardMaterial);
      card.position.set(x,y,z); card.lookAt(0,y,0); room.add(card);
    }
    environment = pmrem.fromScene(room,.035); room.dispose(); pmrem.dispose();
    scene.environment = environment.texture; scene.environmentIntensity = .55;
    scene.add(new THREE.HemisphereLight('#fffaf4','#767988',.72));
    const key = new THREE.DirectionalLight('#fff7ee',1.65); key.position.set(-350,600,550);
    key.castShadow = true; key.shadow.mapSize.set(1024,1024);
    Object.assign(key.shadow.camera,{ left:-500,right:500,top:500,bottom:-500,near:1,far:1700 });
    key.shadow.bias = -.0003; key.shadow.normalBias = .3; scene.add(key);
    const fill = new THREE.DirectionalLight('#e4ecff',.5); fill.position.set(350,180,400); scene.add(fill);
    host.replaceChildren(renderer.domElement); host.dataset.renderer = 'three-mesh';
    observer = new ResizeObserver(invalidate); observer.observe(host);
  } catch {
    renderer?.dispose(); renderer = null; environment?.dispose(); environment = null; unavailable();
  }
  return {
    setActive(value) {
      if (disposed) return;
      const next = Boolean(value);
      host.dataset.previewActive = String(next);
      if (active === next) return;
      active = next;
      if (!active) { if (frame) cancelAnimationFrame(frame); frame = 0; }
      else invalidate();
    },
    update({ lampId,kelvin = DEFAULT_LAMP_KELVIN }) {
      const lamp = getCatalogLamp(lampId);
      if (!lamp) return;
      host.dataset.lampId = lamp.id; host.dataset.mount = lamp.mount;
      host.dataset.warmKelvin = String(kelvin);
      if (!disposed && tint.set(kelvin,performance.now(),shown && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches))) { dirty = true; request(); }
      host.dataset.material = lamp.id === 'tarnaby' ? 'glass-brass-black-steel' : lamp.id === 'tripod' ? 'linen-oak' : 'aluminium-opal';
      if (disposed || !renderer || selected === lamp.id) return;
      selected = lamp.id; pending = lamp;
      request();
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (building) clearTimeout(building);
      cancelLink?.(); observer?.disconnect(); removeModel();
      scene.traverse(object => { if (object.isLight) object.dispose(); });
      environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      host.replaceChildren();
    }
  };
}
