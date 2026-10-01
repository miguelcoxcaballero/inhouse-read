import { layoutShelvedObjects, moveShelfObject } from './shelf-placement.js';

const isCeilingLamp = object => object.kind === 'lamp' && object.mount === 'undershelf';

function joinShelves(floor, ceiling) {
  return Array.from({ length:Math.max(floor.length, ceiling.length) }, (_, index) => {
    const row = floor[index] || { ...ceiling[index], items:[], usedWidth:0, occupiedWidth:0,
      freeWidth:ceiling[index].freeWidth + ceiling[index].occupiedWidth };
    const items = [...row.items, ...(ceiling[index]?.items || [])];
    return { ...row, items, objects:items };
  });
}

/** A light attached to a shelf's underside has its own mounting space. It
 * must never displace the books standing on the shelf below it. */
export function layoutShelfDecorations(objects, options) {
  return joinShelves(
    layoutShelvedObjects(objects.filter(object => !isCeilingLamp(object)), options),
    layoutShelvedObjects(objects.filter(isCeilingLamp), options)
  );
}

/** Drag neighbours only on the same mounting surface, retaining the saved
 * positions of the other surface through the same resize-safe layout. */
export function moveShelfDecoration(objects, key, target, options) {
  const ceiling = isCeilingLamp(objects.find(object => object.key === key) || {});
  const selected = objects.filter(object => isCeilingLamp(object) === ceiling);
  const other = objects.filter(object => isCeilingLamp(object) !== ceiling);
  const moved = moveShelfObject(selected, key, target, options);
  const retained = layoutShelvedObjects(other, options);
  const shelves = ceiling ? joinShelves(retained, moved.shelves) : joinShelves(moved.shelves, retained);
  const positioned = shelves.flatMap(shelf => shelf.items);
  return { shelves, objects:positioned,
    placements:Object.fromEntries(positioned.map(object => [object.key, { shelf:object.shelf, x:object.x }])) };
}
