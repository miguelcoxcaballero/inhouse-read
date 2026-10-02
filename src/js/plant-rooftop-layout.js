import { layoutShelvedObjects } from './shelf-placement.js';

/** Tall plants keep their scale and saved bay preference. A roof is an open
 * surface; its independent packing prevents plants from different bays from
 * occupying the same place after migration. */
export function placeRooftopPlants(layout) {
  const unitWidth = layout.unitWidth || layout.width;
  // Both shelf types are stacks of exact 600 mm units; an unset type (a bare layout) keeps its width.
  const modeled = layout.shelfType === 'baggebo' || layout.shelfType === 'walnut';
  const gap = modeled ? 24 * unitWidth / 600 : 0;
  const roofs = layout.entries.filter(entry => entry.rooftop);
  for (const entry of layout.entries) if (entry.kind === 'plant' && entry.node) entry.node.dataset.plantPlacement = entry.rooftop ? 'rooftop' : 'bay';
  if (!roofs.length) return layout;
  const objects = roofs.map((entry,index) => {
    const unit = modeled ? Math.floor(entry.shelf / 3) : 0;
    return { ...entry, key:`roof:${index}`, shelf:unit,
      x:(entry.x - unit * (unitWidth + gap) - 16) / (unitWidth - 32) };
  });
  const rows = layoutShelvedObjects(objects, { shelfWidth:unitWidth, padding:16, gap:3, minShelves:1 });
  // Extra roofs correspond to complete units, never unsupported plants in air.
  const unitCount = Math.max(layout.unitCount || 1, rows.length);
  for (const row of rows) for (const item of row.items) {
    const entry = roofs[Number(item.key.slice(5))];
    entry.x = item.left + item.width / 2 + row.index * (unitWidth + gap);
    entry.roofUnit = row.index;
  }
  if (modeled) {
    while (layout.rows.length < unitCount * 3) {
      const index = layout.rows.length, template = layout.rows[index % 3];
      const left = Math.floor(index / 3) * (unitWidth + gap);
      layout.rows.push({ ...template, unit:Math.floor(index / 3), left, right:left + unitWidth });
    }
    layout.unitCount = unitCount; layout.width = unitWidth * unitCount + gap * (unitCount - 1);
  } else {
    // The custom wooden shelf may grow horizontally; its scale stays fixed.
    layout.width = unitWidth * unitCount;
  }
  return layout;
}
