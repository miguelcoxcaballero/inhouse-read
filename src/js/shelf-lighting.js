import * as THREE from 'three';

/** A single soft key shadow, fitted to the visible cabinet instead of its
 * entire scroll height. No extra rendering or animation happens at rest. */
export function createShelfLighting(scene, renderer) {
  const key = scene.userData.readerLight;
  if (!key) return { update() {}, dispose() {} };
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -.00018;
  key.shadow.normalBias = .28;
  key.shadow.radius = 2.5;
  key.shadow.autoUpdate = false;
  scene.add(key.target);
  let last = '';
  const update = ({ width, viewportHeight, scroll, depth, dirty = true }) => {
    const signature = [width, viewportHeight, scroll, depth].join(':');
    if (signature !== last) {
      last = signature;
      const extent = Math.max(width, viewportHeight) * .75 + depth * .65;
      key.target.position.set(width / 2, -scroll - viewportHeight / 2, -depth * .35);
      key.position.copy(key.target.position).add(new THREE.Vector3(-280, 600, 1000));
      const camera = key.shadow.camera;
      Object.assign(camera, { left:-extent, right:extent, top:extent, bottom:-extent, near:100, far:2500 });
      camera.updateProjectionMatrix();
      key.target.updateMatrixWorld();
      dirty = true;
    }
    if (dirty) { key.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true; }
  };
  return { update, dispose() { key.shadow.map?.dispose(); key.shadow.mapPass?.dispose(); } };
}
