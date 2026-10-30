// Frozen copies of the cold DOM and record recipes of src/js/bookshelf-scene.js (1.7.325) that
// moved to rust-ui/src/scene_dom.rs. The scene's closure state they used (the bookmark
// function, the replacement callback, the covers map) is passed in; the bodies are unchanged.
const SVG_NS = 'http://www.w3.org/2000/svg';
let foliageSerial = 0;
const PLANT_DIAGNOSTICS = ['plantModelCatalogId', 'plantModelDepth', 'plantLeafTexture', 'plantLeafOpacity'];
export function clearPlantDiagnostics(node) { if (node) for (const key of PLANT_DIAGNOSTICS) delete node.dataset[key]; }

export function rememberTrash(node) {
  return {
    style:node.getAttribute('style'), hidden:node.hidden, tabIndex:node.getAttribute('tabindex'),
    ariaHidden:node.getAttribute('aria-hidden'), inert:Boolean(node.inert || node.hasAttribute('inert'))
  };
}
export function restoreTrash(node, original) {
  for (const [attribute, value] of [['style', original.style], ['tabindex', original.tabIndex], ['aria-hidden', original.ariaHidden]]) {
    if (value === null) node.removeAttribute(attribute); else node.setAttribute(attribute, value);
  }
  node.hidden = original.hidden; node.inert = original.inert;
  for (const key of ['trash3d', 'trashHover', 'hover', 'trashDropProgress', 'dropProgress', 'trashVisible', 'trashViewHidden',
    'trashLocalPosition', 'trashLocalScale', 'trashLocalRotation', 'trashFootY', 'cabinetFloorY', 'trashCameraInFrame',
    'trashFootWorld', 'floorContactWorld', 'trashRadius', 'trashHeight'])
    delete node.dataset[key];
}
export function rememberCatalog(node) {
  return {
    style:node.getAttribute('style'), hidden:node.hidden, tabIndex:node.getAttribute('tabindex'), ariaHidden:node.getAttribute('aria-hidden')
  };
}
export function restoreCatalog(node, original) {
  for (const [attribute, value] of [['style', original.style], ['tabindex', original.tabIndex], ['aria-hidden', original.ariaHidden]]) {
    if (value === null) node.removeAttribute(attribute); else node.setAttribute(attribute, value);
  }
  node.hidden = original.hidden;
  delete node.dataset.catalog3d; delete node.dataset.catalogVisible; delete node.dataset.catalogViewHidden;
}
// updateLayout passes the covers map; dispose removed every cover afterwards instead.
export function restoreButtons(originalStyles, semanticCovers) {
  for (const [node, style] of originalStyles) {
    if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
    delete node.dataset.sceneProjected;
    delete node.dataset.sceneHitSurface;
    delete node.dataset.sceneLean;
    if (semanticCovers) { semanticCovers.get(node)?.remove(); semanticCovers.delete(node); }
    clearPlantDiagnostics(node);
  }
}
export function foliageTarget(node, entry) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const definitions = document.createElementNS(SVG_NS, 'defs');
  const clip = document.createElementNS(SVG_NS, 'clipPath');
  const exclusions = document.createElementNS(SVG_NS, 'path');
  const path = document.createElementNS(SVG_NS, 'path');
  const id = `ihr-foliage-${++foliageSerial}`;
  svg.classList.add('ihr-plant-foliage'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false'); svg.dataset.plantFoliageKey = node.dataset.objectId || entry.key;
  clip.id = id; clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  exclusions.setAttribute('clip-rule', 'evenodd'); clip.append(exclusions); definitions.append(clip);
  path.setAttribute('clip-path', `url(#${id})`); path.setAttribute('fill', 'transparent');
  Object.assign(svg.style, { position:'absolute', pointerEvents:'none', touchAction:'none', overflow:'visible',
    maxWidth:'none', maxHeight:'none' });
  path.style.touchAction = 'none'; svg.append(definitions, path); node.append(svg);
  return [svg, path, exclusions];
}
// The room canvas (0) and the inspection snapshot (1) and overview (2), as the scene made them.
export function canvas(kind) {
  if (kind === 0) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.className = 'ihr-bookshelf-scene';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position:'sticky', top:'0', left:'0', display:'block', pointerEvents:'none', zIndex:'0' });
    return [canvas, context];
  }
  const inspectionCanvas = document.createElement('canvas');
  const inspectionContext = inspectionCanvas.getContext('2d');
  inspectionCanvas.className = kind === 1 ? 'ihr-bookshelf-inspection-snapshot' : 'ihr-bookshelf-inspection-overview';
  inspectionCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(inspectionCanvas.style, { position:'absolute', left:'0', top:'0', display:'none',
    pointerEvents:'none', zIndex:'0', transformOrigin:'0 0', willChange:'transform' });
  if (kind === 1) inspectionCanvas.style.zIndex = '1';
  return [inspectionCanvas, inspectionContext];
}
export function materialKeys(entry, bookmarkFor) {
  const { book, style, coverUrl } = entry;
  return {
    spine:JSON.stringify([style, book.spineTitleOverride, book.title, book.author, book.spineFontSize,
      book.spineAuthorFontSize, book.spineFinish, book.spineSurfaceFinish, book.spineTextFinish, book.spineTextColor, book.spineEngraved]),
    cover:JSON.stringify([coverUrl, style.coverRatio, style.color, !coverUrl && [book.spineTitleOverride, book.title, book.author, book.format, style.fontFamily]]),
    coverFinish:book.coverFinish,
    coverRelief:JSON.stringify(book.coverRelief ?? null),
    edgeFinish:book.pageEdgeFinish,
    bookmark:JSON.stringify(bookmarkFor(book))
  };
}
export const plantKeys = entry => JSON.stringify([entry.width, entry.height, entry.variant, entry.catalogId, entry.potId, entry.potColorId, entry.seed]);
export const plantShapeKeys = entry => JSON.stringify([entry.width, entry.height, entry.variant, entry.catalogId, entry.potId, entry.seed]);
export const lampKeys = entry => JSON.stringify([entry.lampId, entry.width, entry.height, entry.depth, entry.mount]);
export function replacementTarget(entry, bookmarkFor) {
  return {
    geometry:JSON.stringify([entry.kind || 'book',entry.width,entry.height,entry.thickness,
      Boolean(entry.overview),entry.inspectionResolution || 0]),
    materials:materialKeys(entry, bookmarkFor)
  };
}
export function retainReplacement(entry, target) {
  const replacement = entry.replacement, previous = replacement?.userData.shelfReplacementTarget;
  if (entry.kind === 'plant' || entry.kind === 'lamp' || !replacement || entry.qualityReplacement ||
    !previous || previous.geometry !== target.geometry) return false;
  const changed = Object.keys(target.materials).filter(key => previous.materials[key] !== target.materials[key]);
  if (changed.some(key => key !== 'bookmark') || changed.length && !replacement.userData.updateBookmark) return false;
  if (changed.length) replacement.userData.updateBookmark(entry.book);
  replacement.userData.shelfReplacementTarget = target;
  replacement.userData.shelfKeys = target.materials;
  return true;
}
export function updateMaterials(entry, bookmarkFor, replaceWhenReady) {
  const model = entry.model;
  if (!model || entry.kind === 'plant' || entry.kind === 'lamp') return;
  const previous = model.userData.shelfKeys || {}, next = materialKeys(entry, bookmarkFor);
  if (previous.spine !== next.spine) model.userData.updateSpineAppearance?.(entry.book, entry.style);
  if (previous.cover !== next.cover) model.userData.updateCoverSource?.(entry.coverUrl, entry.book, entry.style);
  if (previous.coverFinish !== next.coverFinish || previous.coverRelief !== next.coverRelief) model.userData.updateCoverAppearance?.(entry.book);
  if (previous.edgeFinish !== next.edgeFinish) model.userData.updateEdgeAppearance?.(entry.book);
  if (previous.bookmark !== next.bookmark) {
    if (model.userData.updateBookmark) model.userData.updateBookmark(entry.book);
    else { replaceWhenReady(entry); return; }
  }
  model.userData.shelfKeys = next;
}

export function releaseObject(object) {
  const materials = new Set();
  object.traverse(child => {
    child.geometry?.dispose();
    for (const material of [].concat(child.material || [])) materials.add(material);
  });
  for (const material of materials) material.dispose();
}
export function refreshFonts(bookEntries) {
  for (const entry of bookEntries) {
    if (entry.kind === 'plant' || entry.kind === 'lamp') continue;
    for (const model of new Set([entry.model, entry.replacement])) {
      if (!model) continue;
      const redraw = model.userData.invalidate;
      model.userData.invalidate = null;
      try {
        model.userData.updateSpineAppearance?.(entry.book, entry.style);
        if (!entry.coverUrl) model.userData.updateCoverSource?.(null, entry.book, entry.style);
      } finally { model.userData.invalidate = redraw; }
    }
  }
}
// makeModel's two walks between creating the model and its keys.
export function prepareModel(model, entry, renderer) {
  model.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : [])
      for (const key of ['map','normalMap','bumpMap','roughnessMap'])
        if (material[key]) material[key].anisotropy = Math.min(16,renderer.capabilities.getMaxAnisotropy());
  });
  model.userData.entry = entry;
  model.traverse(object => {
    if (object.isMesh) {
      if (entry.kind !== 'lamp') object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}
// animateFromRects' items and dragged entry.
export function reorderItems(bookEntries, oldRects, stageRect, draggedKey) {
  const items = [];
  for (const entry of bookEntries) {
    const old = oldRects.get(entry.node?.dataset.objectId) || oldRects.get(entry.book?.id) ||
      oldRects.get(entry.node?.dataset.bookId) || oldRects.get(entry.key);
    const targetRect = entry.tapRect || entry.hitRect || entry.rect;
    if (!old || !targetRect) continue;
    const x = old.left - (targetRect.left + stageRect.left), y = old.top - (targetRect.top + stageRect.top);
    if (Math.abs(x) + Math.abs(y) > 1) items.push({ entry, x, y });
  }
  const dragged = draggedKey == null ? null : items.find(item =>
    String(item.entry.node?.dataset.objectId ?? item.entry.key) === String(draggedKey))?.entry;
  return [items, dragged];
}
