import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createShelfLamp } from './shelf-lamps.js';
import { getCatalogLamp } from './lamp-catalog-data.js';
import { createShelfLampLighting } from './shelf-lamp-lighting.js';

/** The actual shelf lamp, with its own warm light and reflected studio lighting. */
export function createLampCatalogPreview(host) {
  let renderer, environment, model, observer, fixture, target, filamentLighting, frame = 0, disposed = false, active = true, selected;
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
    if (disposed || !active || !renderer || !model) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1,rect.width), height = Math.max(1,rect.height), aspect = width / height;
    const half = Math.max(size.y / 2,size.x / (2 * aspect)) * 1.13;
    camera.left = -half * aspect; camera.right = half * aspect;
    camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
    filamentLighting?.update([{ kind:'lamp',key:'catalog-filaments',model,width:size.x }]);
    renderer.setSize(width,height,false); renderer.render(scene,camera);
    host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
  }
  function invalidate() {
    if (!disposed && active && !frame) frame = requestAnimationFrame(render);
  }
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
  try {
    if (typeof WebGLRenderingContext === 'undefined') throw new Error('WebGL unavailable');
    renderer = new THREE.WebGLRenderer({ antialias:true,alpha:true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      active = Boolean(value);
      host.dataset.previewActive = String(active);
      if (!active) { if (frame) cancelAnimationFrame(frame); frame = 0; }
      else invalidate();
    },
    update({ lampId }) {
      const lamp = getCatalogLamp(lampId);
      if (!lamp) return;
      host.dataset.lampId = lamp.id; host.dataset.mount = lamp.mount;
      host.dataset.warmKelvin = String(lamp.warmKelvin);
      if (disposed || !renderer || selected === lamp.id) return;
      selected = lamp.id; removeModel(); display.position.set(0,0,0);
      model = createShelfLamp({ lampId:lamp.id,width:lamp.dimensions.width,quality:'high' });
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
      host.dataset.material = lamp.id === 'tarnaby' ? 'glass-brass-black-steel' : lamp.id === 'tripod' ? 'linen-oak' : 'aluminium-opal';
      host.dataset.lightEmitter = emitter ? 'warm-physical' : 'none';
      invalidate();
    },
    dispose() {
      if (disposed) return; disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect(); removeModel();
      scene.traverse(object => { if (object.isLight) object.dispose(); });
      environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      host.replaceChildren();
    }
  };
}
