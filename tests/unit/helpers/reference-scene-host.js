// Frozen JavaScript originals of the shelf scene recipes that moved to rust-ui/src/scene_host.rs
// (bookshelf-scene.js before the move). The closure's variables are parameters here; the bodies are
// unchanged. tests/unit/scene-host-wasm.test.js runs each against its Rust port on equal inputs.
import * as THREE from 'three';
import { clearPlantDiagnostics, lampKeys, plantKeys, plantShapeKeys } from './reference-scene-dom.js';

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

export const entryKey = (entry, index) => entry.kind === 'plant' || entry.kind === 'lamp'
  ? `${entry.kind}:${entry.node?.dataset.objectId ?? entry.key ?? index}`
  : `book:${String(entry.book?.id ?? entry.node?.dataset.bookId ?? entry.book?.path ?? entry.book?.title ?? index)}`;

// rebuildFurniture's floor measurement; floorY was its min.y.
export function localBounds(cabinet) {
  const localBounds = new THREE.Box3();
  const measureLocal = (object, parentMatrix) => {
    object.updateMatrix();
    const matrix = parentMatrix.clone().multiply(object.matrix);
    if (object.geometry) {
      object.geometry.computeBoundingBox();
      localBounds.union(object.geometry.boundingBox.clone().applyMatrix4(matrix));
    }
    for (const child of object.children) measureLocal(child, matrix);
  };
  measureLocal(cabinet, new THREE.Matrix4());
  return localBounds;
}

// updateLayout's check, after `resized && next.entries.length === bookEntries.length`.
export function samePlacements(oldEntries, nextEntries) {
  return nextEntries.every((data,index) => {
    const old = oldEntries.get(entryKey(data,index));
    return old && old.shelf === data.shelf && (!data.book ||
      JSON.stringify(old.book?.shelfPosition) === JSON.stringify(data.book.shelfPosition));
  });
}

export function paintedPoses(bookEntries, motionKey, width, ppm) {
  return bookEntries.filter(e=>motionKey(e)).map(e=>{
    const p=e.pose.position,q=e.pose.quaternion;
    return [motionKey(e),(p.x+width/2)/ppm,p.y/ppm,p.z/ppm,q.x,q.y,q.z,q.w,e.pose.scale.x];
  });
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

// beginInspectionGesture's two scans: 0 not stationary, 1 stationary, 2 stationary with pressure.
export function inspectionRest(bookEntries, now) {
  const stationary = bookEntries.every(entry => !entry.insertion && !entry.trashDrop && !entry.landing &&
    !entry.preview.active && !entry.node?.matches('.is-pressed, .is-lifted, .is-dragging') &&
    [entry.lift.value, entry.lift.from, entry.lift.target].every(value => Math.abs(value) <= .220001) &&
    !entry.lampTint?.moving() &&
    !(entry.lampPower?.duration && entry.lampPower.from !== entry.lampPower.target &&
      now < entry.lampPower.started + entry.lampPower.duration));
  if (!stationary) return 0;
  const pressure = bookEntries.some(entry => entry.lift.value || entry.lift.from || entry.lift.target);
  return pressure ? 2 : 1;
}

// canDeferModalPaint's final scan of the entries.
export function modalRest(bookEntries, selected, now) {
  for (const entry of bookEntries) {
    if (entry.insertion || entry.trashDrop || entry.landing || entry.preview.active) return false;
    if (entry.lampTint?.moving()) return false;
    if (entry.lampPower && (entry.lampPower.value !== entry.lampPower.target ||
      entry.lampPower.from !== entry.lampPower.target && now < entry.lampPower.started + entry.lampPower.duration)) return false;
    if (entry !== selected) {
      const target = entry.node?.matches('.is-dragging, .is-lifted') ? 1
        : entry.node?.classList.contains('is-pressed') && !entry.node.classList.contains('is-press-pending') ? .22 : 0;
      if (entry.lift.value !== target) return false;
    }
  }
  return true;
}

// setMode's bin node when the view leaves the isometric room.
export function hideTrashNode(trashNode) {
  trashNode.hidden = true; trashNode.inert = true; trashNode.tabIndex = -1;
  trashNode.setAttribute('aria-hidden', 'true'); trashNode.style.pointerEvents = 'none';
}

// adoptMetadataRecords after its scene-wide guards, up to the assignment of the records.
export function adoptRecords(bookEntries, previous, records, byNode, stateFor, canAdoptShelfMetadata) {
  const books = bookEntries.filter(entry => entry.kind !== 'plant' && entry.kind !== 'lamp');
  if (!Array.isArray(records) || records.length !== books.length ||
      bookEntries.some(entry => entry.replacement || entry.plantQuality || entry.insertion || entry.trashDrop || entry.preview.active || entry.landing))
    return false;
  const byId = new Map(books.map(entry => [String(entry.book?.id), entry]));
  if (byId.size !== books.length || !canAdoptShelfMetadata(previous, records)) return false;
  for (const book of previous) {
    const entry = byId.get(String(book.id));
    if (!entry || entry.book !== book || !entry.node?.isConnected || byNode.get(entry.node) !== entry || stateFor(entry) !== entry.state)
      return false;
  }
  for (const book of records) byId.get(String(book.id)).book = book;
  return true;
}

// setLampPower's new fade; `animate` is `animate && !reducedMotion.matches`.
export function lampSwitch(entry, isOn, animate) {
  const previous = entry.lampPower?.value ?? entry.model?.userData.lightEmitter?.power ?? (entry.isOn === false ? 0 : 1);
  entry.isOn = isOn !== false;
  const target = entry.isOn ? 1 : 0;
  entry.lampPower = { value:previous, from:previous, target, started:performance.now(),
    duration:animate ? 220 : 0 };
}

export const coversPending = (bookEntries, caller) => bookEntries.some(entry => entry !== caller && entry.kind !== 'plant' && entry.kind !== 'lamp' &&
  entry.model?.visible && entry.model.userData.coverLoaded === undefined);

// captureNativeInspection's reuse of the other tile's capture.
export function sharedCapture(captured, overview, frame, raw, sourceFrame, sourceContext, sourceRevision, sourceMaterialized) {
  return Boolean(captured && captured.overview!==overview && captured.frame===frame && sourceFrame===frame &&
    captured.context===sourceContext && sourceContext!==raw && captured.revision===sourceRevision &&
    sourceMaterialized===sourceRevision && captured.width===Math.ceil(frame.width*frame.ratio) && captured.height===Math.ceil(frame.height*frame.ratio) &&
    raw.canvas.width===captured.width && raw.canvas.height===captured.height &&
    sourceContext.canvas.width===captured.width && sourceContext.canvas.height===captured.height);
}

// updateLayout's rebinding loop; the closure's maps and functions come in `host`, and the record keys are
// the frozen originals of reference-scene-dom.js.
export function rebindEntries(nextEntries, oldEntries, host) {
  const { foliage:semanticFoliage, styles:originalStyles, release:releaseEntry, place:placeBoxes, fresh:freshEntry } = host;
  const updateRecord = (entry, book, style, coverUrl, data) => host.record(entry, data);
  const next = { entries:nextEntries };
  const retained = [];
  for (let index = 0; index < next.entries.length; index++) {
    const data = next.entries[index], key = entryKey(data, index);
    let entry = oldEntries.get(key);
    if (entry) {
      oldEntries.delete(key);
      if (entry.node !== data.node && entry.node?.classList.contains('is-away')) data.node?.classList.add('is-away');
      if (data.kind === 'plant' || data.kind === 'lamp') {
        const changed = data.kind === 'lamp' ? lampKeys(entry) !== lampKeys(data) : plantKeys(entry) !== plantKeys(data);
        let retainModel = !changed;
        if (changed) {
          const recolored = data.kind === 'plant' && plantShapeKeys(entry) === plantShapeKeys(data) &&
            entry.model?.userData.updatePotColor?.(data.potColorId);
          if (!recolored) releaseEntry(entry);
          else {
            entry.plantQuality?.plan.dispose(); entry.plantQuality = null;
            entry.model.userData.shelfPlantKeys = plantKeys(data); retainModel = true;
          }
        }
        if (retainModel && entry.node !== data.node) {
          const native = semanticFoliage.get(entry.node);
          if (native && data.node) {
            semanticFoliage.delete(entry.node);
            const svg = native.svg.cloneNode(true);
            native.svg.remove();
            const rebound = { ...native,svg,path:svg.querySelector(':scope > path'),
              exclusions:svg.querySelector('clipPath path') };
            data.node.append(svg); semanticFoliage.set(data.node,rebound);
          }
        }
        if (entry.node !== data.node) clearPlantDiagnostics(entry.node);
        Object.assign(entry, data); placeBoxes(entry);
      } else { entry.node = data.node; updateRecord(entry, data.book, data.style, data.coverUrl, data); }
    } else { entry = freshEntry(data, index); placeBoxes(entry); }
    entry.preview = freshPreview();
    entry.landing = null;
    entry.written = null; entry.leanNode = null; entry.domDirty = true;
    entry.key = key;
    retained.push(entry);
    if (entry.node && !originalStyles.has(entry.node)) originalStyles.set(entry.node, entry.node.getAttribute('style'));
  }
  return retained;
}

const NO_FLAGS = Object.freeze({ away:false, dragging:false, lifted:false, pressed:false });
export const freshPreview = () => ({ x:0, y:0, fromX:0, fromY:0, targetX:0, targetY:0, started:0, active:false });
export const freshEntry = (entry, index, pose = new THREE.Object3D(), flags = NO_FLAGS) => ({ ...entry, key:entryKey(entry, index), model:null, replacement:null, pose,
  lift:{ value:0, from:0, target:0, started:0 }, landing:null, offset:{ x:0, y:0 }, preview:freshPreview(), state:'', rect:null, hitRect:null, insertion:null,
  overview:false, inspectionResolution:0, qualityReplacement:false, replacementReady:false,
  classText:null, flags, bits:0, dragX:'', dragY:'', dragNumberX:0, dragNumberY:0, stateText:'', box:null, fallback:null,
  written:null, seen:0, domDirty:true });
