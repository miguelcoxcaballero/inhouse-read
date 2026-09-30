/**
 * Positions on a shelf are saved as centres in its usable width (0..1),
 * rather than pixels. A phone resize therefore keeps deliberately empty
 * space, while physical object widths still prevent overlapping spines.
 *
 * Inputs are flat objects { key, kind, width, shelf?, x?, ... }. Books use
 * `book:<id>` and plants use `plant:<seed>`. No DOM or storage is involved.
 */

const EPSILON = 0.000001;
const MAX_SHELF = 999;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function configuration(options = {}) {
  const shelfWidth = finite(options.shelfWidth) ? options.shelfWidth : 360;
  const padding = finite(options.padding) ? Math.max(0, options.padding) : 16;
  const gap = finite(options.gap) ? Math.max(0, options.gap) : 3;
  return {
    ...options,
    shelfWidth,
    padding,
    gap,
    available: shelfWidth - padding * 2,
    minShelves: clamp(finite(options.minShelves) ? Math.floor(options.minShelves) : 3, 0, MAX_SHELF + 1)
  };
}

function shelfNumber(value, fallback = 0) {
  return finite(value) && value >= 0 ? clamp(Math.floor(value), 0, MAX_SHELF) : fallback;
}

function placementFor(value) {
  if (!value || !finite(value.shelf) || value.shelf < 0 || !finite(value.x)) return null;
  return { shelf: shelfNumber(value.shelf), x: clamp(value.x, 0, 1) };
}

function objectsFor(objects, cfg) {
  const keys = new Set();
  return (Array.isArray(objects) ? objects : []).filter(Boolean).flatMap((object, order) => {
    if (typeof object.key !== 'string' || !object.key || keys.has(object.key)) return [];
    keys.add(object.key);
    const requestedWidth = object.width ?? object.displayWidth ?? object.style?.width;
    const width = clamp(finite(requestedWidth) && requestedWidth > 0 ? requestedWidth : 32, 1, cfg.available);
    const saved = placementFor(cfg.placements?.[object.key]);
    const shelf = saved?.shelf ?? shelfNumber(object.shelf ?? object.row);
    const x = saved?.x ?? (finite(object.x) ? clamp(object.x, 0, 1) : null);
    const requestedCenter = x == null ? null : cfg.padding + x * cfg.available;
    const center = x == null ? null : clamp(requestedCenter, cfg.padding + width / 2, cfg.shelfWidth - cfg.padding - width / 2);
    return [{ object, key: object.key, width, shelf, desiredLeft: center == null ? null : center - width / 2,
      requestedX:center === requestedCenter ? x : null, order }];
  });
}

const inOrder = (a, b) => a.desiredLeft + a.width / 2 - (b.desiredLeft + b.width / 2) || a.order - b.order;

/** Find the first free gap without removing intentionally empty space. */
function freeLeft(items, width, cfg) {
  let cursor = cfg.padding;
  for (const item of [...items].sort((a, b) => a.left - b.left)) {
    if (item.left - cfg.gap - cursor >= width - EPSILON) return cursor;
    cursor = Math.max(cursor, item.left + item.width + cfg.gap);
  }
  return cursor + width <= cfg.shelfWidth - cfg.padding + EPSILON ? cursor : null;
}

/**
 * Preserve desired gaps first. Only an actual collision pushes a neighbour.
 * If a row fits in total, a correction from the right end keeps the last
 * object inside the shelf instead of needlessly creating another row.
 */
function solveRow(candidates, cfg) {
  const sorted = [...candidates].sort(inOrder);
  const kept = [];
  const overflow = [];
  let occupied = 0;
  for (const item of sorted) {
    const cost = item.width + (kept.length ? cfg.gap : 0);
    if (occupied + cost > cfg.available + EPSILON) {
      overflow.push(item);
    } else {
      occupied += cost;
      kept.push(item);
    }
  }
  let cursor = cfg.padding;
  const placed = kept.map(item => {
    const left = Math.max(item.desiredLeft, cursor);
    cursor = left + item.width + cfg.gap;
    return { ...item, left };
  });
  cursor = cfg.shelfWidth - cfg.padding;
  for (let index = placed.length - 1; index >= 0; index -= 1) {
    const item = placed[index];
    item.left = Math.min(item.left, cursor - item.width);
    cursor = item.left - cfg.gap;
  }
  return { placed, overflow };
}

/** The dragged object occupies exactly the chosen point, even in a full row. */
function solvePinnedRow(candidates, pin, cfg) {
  const pinCenter = pin.desiredLeft + pin.width / 2;
  const others = candidates.filter(item => item.key !== pin.key).sort(inOrder);
  const leftSide = others.filter(item => item.desiredLeft + item.width / 2 < pinCenter);
  const rightSide = others.filter(item => item.desiredLeft + item.width / 2 >= pinCenter);
  const placed = [{ ...pin, left: pin.desiredLeft }];
  const overflow = [];
  let cursor = pin.desiredLeft - cfg.gap;
  for (let index = leftSide.length - 1; index >= 0; index -= 1) {
    const item = leftSide[index];
    const left = Math.min(item.desiredLeft, cursor - item.width);
    if (left < cfg.padding - EPSILON) overflow.push(item);
    else {
      placed.push({ ...item, left });
      cursor = left - cfg.gap;
    }
  }
  cursor = pin.desiredLeft + pin.width + cfg.gap;
  for (const item of rightSide) {
    const left = Math.max(item.desiredLeft, cursor);
    if (left + item.width > cfg.shelfWidth - cfg.padding + EPSILON) overflow.push(item);
    else {
      placed.push({ ...item, left });
      cursor = left + item.width + cfg.gap;
    }
  }
  // A neighbour can change sides if there is a real free gap there. Plants
  // and books use the same rule; neither is an immovable decorative blocker.
  const remaining = [];
  for (const item of overflow.sort(inOrder)) {
    const left = freeLeft(placed, item.width, cfg);
    if (left == null) remaining.push(item);
    else placed.push({ ...item, left });
  }
  return { placed, overflow: remaining };
}

function layout(objects, cfg, movedKey = null) {
  if (!(cfg.available > 0)) return [];
  const normalized = objectsFor(objects, cfg);
  const rows = new Map();
  const automatic = [];
  for (const item of normalized) {
    if (item.desiredLeft == null) automatic.push(item);
    else {
      if (!rows.has(item.shelf)) rows.set(item.shelf, []);
      rows.get(item.shelf).push(item);
    }
  }
  const solved = new Map();
  let lastRow = Math.max(-1, ...rows.keys());
  for (let index = 0; index <= lastRow; index += 1) {
    const candidates = rows.get(index) || [];
    const pin = candidates.find(item => item.key === movedKey);
    const result = pin ? solvePinnedRow(candidates, pin, cfg) : solveRow(candidates, cfg);
    solved.set(index, result.placed);
    if (result.overflow.length) {
      const next = index + 1;
      // Overflow may extend beyond the saved-row safeguard. It is generated
      // from the finite input list and cannot introduce unbounded empty rows.
      if (!rows.has(next)) rows.set(next, []);
      rows.get(next).push(...result.overflow.map(item => ({ ...item, shelf: next })));
      lastRow = Math.max(lastRow, next);
    }
  }
  for (const item of automatic) {
    let index = item.shelf;
    let left = null;
    while (left == null) {
      if (!solved.has(index)) solved.set(index, []);
      left = freeLeft(solved.get(index), item.width, cfg);
      if (left == null) index += 1;
    }
    solved.get(index).push({ ...item, shelf: index, left });
    lastRow = Math.max(lastRow, index);
  }
  return Array.from({ length: Math.max(cfg.minShelves, lastRow + 1) }, (_, index) => {
    const items = (solved.get(index) || []).sort((a, b) => a.left - b.left || a.order - b.order).map(item => {
      const center = item.left + item.width / 2;
      return {
        ...item.object,
        key: item.key,
        width: item.width,
        shelf: index,
        row: index,
        // Unmoved neighbours keep their exact saved value. Converting it to
        // pixels and back otherwise introduces drift on every placement save.
        x: item.key !== movedKey && item.requestedX != null && item.left === item.desiredLeft
          ? item.requestedX : clamp((center - cfg.padding) / cfg.available, 0, 1),
        left: item.left,
        center
      };
    });
    const usedWidth = items.length ? Math.max(...items.map(item => item.left + item.width)) - cfg.padding : 0;
    const occupiedWidth = items.reduce((total, item) => total + item.width, 0) + cfg.gap * Math.max(0, items.length - 1);
    return { index, width: cfg.shelfWidth, usedWidth, occupiedWidth, freeWidth: Math.max(0, cfg.available - occupiedWidth), items, objects: items };
  });
}

/**
 * Lay out saved objects, keep empty gaps, and insert objects with no x into
 * the first available gap from their requested row onward.
 * Output items add { left, center } in pixels and normalized { shelf, x }.
 */
export function layoutShelvedObjects(objects, options = {}) {
  return layout(objects, configuration(options));
}

/**
 * Move one book OR plant. The returned `placements` is a complete, cleaned
 * snapshot for all present objects, including neighbours displaced by it.
 * Persist that snapshot, not just the dragged object's target. It can be
 * used as cfg.placements on later calls or after a viewport resize.
 */
export function moveShelfObject(objects, key, target, options = {}) {
  const cfg = configuration(options);
  const targetPlacement = placementFor(target);
  const exists = Array.isArray(objects) && objects.some(object => object?.key === key);
  if (exists && targetPlacement) cfg.placements = { ...cfg.placements, [key]: targetPlacement };
  const shelves = layout(objects, cfg, exists && targetPlacement ? key : null);
  const positionedObjects = shelves.flatMap(shelf => shelf.items);
  const placements = Object.fromEntries(positionedObjects.map(object => [object.key, { shelf: object.shelf, x: object.x }]));
  return { shelves, objects: positionedObjects, placements };
}
