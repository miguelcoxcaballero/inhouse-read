// Frozen JavaScript originals of the shelf scene recipes that moved to rust-ui/src/scene_host.rs
// (bookshelf-scene.js before the move). The closure's variables are parameters here; the bodies are
// unchanged. tests/unit/scene-host-wasm.test.js runs each against its Rust port on equal inputs.
import * as THREE from 'three';

export function trashFootprint(bin) {
  const position = bin.position.clone(), rotation = bin.rotation.clone(), scale = bin.scale.clone();
  const openness = Number(bin.userData.openness) || 0;
  const bounds = new THREE.Box3();
  bin.position.set(0, 0, 0); bin.rotation.set(0, 0, 0); bin.scale.setScalar(1);
  for (const open of [0, .5, 1]) {
    bin.userData.setState({ openness:open }); bin.updateMatrixWorld(true);
    bounds.union(new THREE.Box3().setFromObject(bin));
  }
  bin.position.copy(position); bin.rotation.copy(rotation); bin.scale.copy(scale);
  bin.userData.setState({ openness }); bin.updateMatrixWorld(true);
  return bounds;
}

export function veneerSwatch(map, mean) {
  const swatch = document.createElement('canvas'), context = swatch.getContext('2d');
  swatch.width = swatch.height = 1;
  if (context) { context.fillStyle = mean; context.fillRect(0, 0, 1, 1); }
  map.image = swatch; map.needsUpdate = true;
}

const WOOD_TONES = {
  light:{ wood:'#ffffff', back:'#ebe8e4', trim:'#f5f2ee' },
  dark:{ wood:'#ebe8e5', back:'#d2cec9', trim:'#e0dcd7' }
};
// updateWoodTheme without its final rebuildOcclusion check; `dark` is darkPage().
export function woodTheme(dark, wood, backWood, darkWood, occlusionMaterial, roomWallMaterial) {
  const darkPage = () => dark;
  const tones = WOOD_TONES[darkPage() ? 'dark' : 'light'];
  wood.color.set(tones.wood); backWood.color.set(tones.back); darkWood.color.set(tones.trim);
  occlusionMaterial.opacity = tones === WOOD_TONES.dark ? 1 : .8;
  roomWallMaterial.color.set(darkPage() ? '#353434' : '#f0f1ed');
}

// updateLayout's rebinding of a retained plant's native foliage to `node` (data.node).
export function rebindFoliage(native, node) {
  const svg = native.svg.cloneNode(true);
  native.svg.remove();
  const rebound = { ...native,svg,path:svg.querySelector(':scope > path'),
    exclusions:svg.querySelector('clipPath path') };
  node.append(svg);
  return rebound;
}

// cancelTrashDrop after its `if (!drop) return; inspectionOverview = null;`; returns casterListDirty's change.
export function cancelTrashDrop(entry, restore, furniture, trashNode, canvas) {
  let casterListDirty = false;
  const drop = entry.trashDrop;
  entry.trashDrop = null;
  if (!drop.settled) { drop.settled = true; drop.resolve(false); }
  if (entry.model && restore) {
    furniture.attach(entry.model);
    const visible = !entry.node?.classList.contains('is-away');
    if (entry.model.visible !== visible) casterListDirty = true;
    entry.model.visible = visible;
    entry.model.position.copy(entry.pose.position);
    entry.model.quaternion.copy(entry.pose.quaternion);
    entry.model.scale.copy(entry.pose.scale);
  }
  if (trashNode) {
    delete trashNode.dataset.trashDropProgress;
    delete trashNode.dataset.dropProgress;
  }
  delete canvas.dataset.trashDropProgress;
  delete canvas.dataset.trashingBookId;
  delete canvas.dataset.trashingObjectId;
  delete canvas.dataset.trashingObjectKind;
  return casterListDirty;
}

// makeModel's plant diagnostics for an entry with a node.
export function plantDiagnostics(model, node) {
  const leaf = model.getObjectByName('leaf-0'), size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.userData.shelfPlantDiagnostics = { plantModelCatalogId:model.userData.catalogId,
    plantModelDepth:size.z.toFixed(4),
    plantLeafTexture:leaf ? leaf.material.map?.isDataTexture ? 'procedural' : leaf.material.map ? 'photo' : 'none' : 'vertex-colors',
    plantLeafOpacity:!leaf || leaf.material.alphaTest === 0 && !leaf.material.alphaToCoverage ? 'opaque' : 'cutout' };
  Object.assign(node.dataset, model.userData.shelfPlantDiagnostics);
}

// setMode's bin node when the view leaves the isometric room.
export function hideTrashNode(trashNode) {
  trashNode.hidden = true; trashNode.inert = true; trashNode.tabIndex = -1;
  trashNode.setAttribute('aria-hidden', 'true'); trashNode.style.pointerEvents = 'none';
}

// setLampPower's new fade; `animate` is `animate && !reducedMotion.matches`.
export function lampSwitch(entry, isOn, animate) {
  const previous = entry.lampPower?.value ?? entry.model?.userData.lightEmitter?.power ?? (entry.isOn === false ? 0 : 1);
  entry.isOn = isOn !== false;
  const target = entry.isOn ? 1 : 0;
  entry.lampPower = { value:previous, from:previous, target, started:performance.now(),
    duration:animate ? 220 : 0 };
}

// captureNativeInspection's reuse of the other tile's capture.
export function sharedCapture(captured, overview, frame, raw, sourceFrame, sourceContext, sourceRevision, sourceMaterialized) {
  return Boolean(captured && captured.overview!==overview && captured.frame===frame && sourceFrame===frame &&
    captured.context===sourceContext && sourceContext!==raw && captured.revision===sourceRevision &&
    sourceMaterialized===sourceRevision && captured.width===Math.ceil(frame.width*frame.ratio) && captured.height===Math.ceil(frame.height*frame.ratio) &&
    raw.canvas.width===captured.width && raw.canvas.height===captured.height &&
    sourceContext.canvas.width===captured.width && sourceContext.canvas.height===captured.height);
}
