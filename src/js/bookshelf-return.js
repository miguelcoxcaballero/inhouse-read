import * as THREE from 'three';

const CASE_FIELDS = ['id','path','name','title','author','format','spineTitleOverride','spineColorOverride',
  'spineFontFamily','spineFontSize','spineAuthorFontSize','spineFinish','spineSurfaceFinish','spineTextFinish',
  'spineTextColor','spineEngraved','coverFinish','coverRelief','pageEdgeFinish'];

/** Keep the case's visual inputs strict. Storage/cloud metadata and progress
 * cannot alter its pixels; final progress is applied to the ribbon separately. */
export function bookReturnSignature(book, style, geometry, coverUrl) {
  if (!geometry || Object.values(geometry).some(value => !Number.isFinite(value))) return null;
  if (['width','height','thickness','viewportWidth','viewportHeight'].some(key => !(geometry[key] > 0))) return null;
  const appearance = CASE_FIELDS.map(key => book?.[key]);
  return JSON.stringify([appearance,style,geometry,coverUrl]);
}


const RETURN_PAINT_FIELDS = new Set(['color','shade','ink','fontFamily','fontCanvasFamily',
  'fontFallback','fontWeight','appearanceSource']);
const CANONICAL_GEOMETRY_FIELDS = new Set(['width','height','thickness','centerX','centerY']);

/** Explicit reuse key: discard only arithmetic noise in the comparison, never
 * in the actual geometry. Viewport, cover ratio and structural style stay strict. */
export function bookReturnCompatibility(book, style, geometry) {
  if (!bookReturnSignature(book,style,geometry,null)) return null;
  const dimensions = Object.keys(geometry).sort().map(key => [key,
    CANONICAL_GEOMETRY_FIELDS.has(key) ? Number(geometry[key].toPrecision(14)) : geometry[key]]);
  const structure = Object.keys(style || {}).sort().filter(key => !RETURN_PAINT_FIELDS.has(key))
    .map(key => [key,style[key]]);
  return JSON.stringify([CASE_FIELDS.map(key => book?.[key]),structure,dimensions]);
}

/** One already rendered book may wait behind the reader. Ownership transfers
 * once to the close animation; a mismatch, replacement or destroy releases it. */
export function createBookReturnCache() {
  let held = null, taking = null;
  const release = previous => {
    if (previous && !previous.released) { previous.released = true; previous.view.dispose(); }
  };
  const clear = () => { const previous = held; held = null; release(previous); release(taking); taking = null; };
  return {
    retain(signature, view, compatibility = null) {
      clear();
      if (!signature || !view) { view?.dispose(); return false; }
      held = { signature,view,compatibility }; return true;
    },
    take(signature) {
      const previous = held; held = null;
      if (previous && signature && previous.signature === signature) return previous.view;
      previous?.view.dispose(); return null;
    },
    async takeCompatible({ signature,compatibility,book,style,coverUrl }) {
      const previous = held; held = null;
      if (!previous) return null;
      if (signature && previous.signature === signature) return previous.view;
      if (!compatibility || compatibility !== previous.compatibility ||
          typeof previous.view.prepareReturnAppearance !== 'function') { release(previous); return null; }
      taking = previous;
      try {
        const ready = await previous.view.prepareReturnAppearance(book,style,coverUrl);
        if (taking !== previous || previous.released) return null;
        taking = null;
        if (ready === true) return previous.view;
      } catch { /* dispose the unpresented model; the caller constructs its original fallback */ }
      if (taking === previous) taking = null;
      release(previous); return null;
    },
    clear
  };
}

/** A parked book's transform in the cabinet's coordinate system. */
export function shelfBookSlot(entry, cabinetWidth) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(entry.x - cabinetWidth / 2, -entry.y, -entry.width / 2 - (entry.depthInset || 0)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'XYZ')),
    new THREE.Vector3(1, 1, 1)
  );
}

/** Move the aligned book entirely outside the cabinet before sliding it in. */
export function shelfBookInsertion(slot, bookWidth, progress = 0) {
  const remaining = 1 - Math.max(0, Math.min(1, progress));
  const matrix = slot.clone();
  matrix.elements[13] += 6 * remaining;
  matrix.elements[14] += (bookWidth + 24) * remaining;
  return matrix;
}

/** Preserve the full composed rotation when switching between both canvases. */
export function projectShelfBookPose(furnitureMatrix, localMatrix, dimensions, stageRect) {
  const world = new THREE.Matrix4().multiplyMatrices(furnitureMatrix, localMatrix);
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  world.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    width:dimensions.width, height:dimensions.height, thickness:dimensions.thickness,
    angle:THREE.MathUtils.radToDeg(rotation.y), pitch:THREE.MathUtils.radToDeg(rotation.x),
    roll:THREE.MathUtils.radToDeg(rotation.z), scale:scale.x,
    centerX:stageRect.left + position.x, centerY:stageRect.top - position.y, depth:position.z
  };
}
