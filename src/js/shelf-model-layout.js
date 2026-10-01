import { BAGGEBO_SPEC } from './shelf-types.js';

/** Keep every BAGGEBO at its real proportions. Overflow uses another unit,
 * rather than adding shelves or stretching the original piece of furniture. */
export function baggeboLayout(layout) {
  const unitWidth = layout.width;
  const scale = unitWidth / BAGGEBO_SPEC.width;
  const unitGap = 24 * scale;
  const shelvesPerUnit = BAGGEBO_SPEC.shelfBottoms.length;
  const unitCount = Math.max(1, Math.ceil(layout.rows.length / shelvesPerUnit));
  const rows = Array.from({ length:unitCount * shelvesPerUnit }, (_, index) => {
    const slot = index % shelvesPerUnit, unit = Math.floor(index / shelvesPerUnit);
    const left = unit * (unitWidth + unitGap);
    return { left, right:left + unitWidth, unit,
      padding:Math.max(16, (BAGGEBO_SPEC.postSize + 4) * scale),
      top:(slot ? BAGGEBO_SPEC.shelfBottoms[slot - 1] + BAGGEBO_SPEC.shelfRimHeight : BAGGEBO_SPEC.postSize) * scale,
      bottom:BAGGEBO_SPEC.shelfBottoms[slot] * scale };
  });
  const entries = layout.entries.map(entry => {
    const index = Math.max(0, Math.min(rows.length - 1, entry.shelf ?? 0));
    const row = rows[index];
    // A book's depth is its cover width. Preserve its aspect ratio when a
    // landscape cover or tall plant would exceed the actual usable space.
    const height = entry.kind === 'plant' ? entry.height : 280 * scale * entry.style.heightRatio;
    const width = entry.kind === 'plant' ? entry.width : height * entry.width / entry.height;
    const fit = Math.min(1, (row.bottom - row.top - 4 * scale) / height,
      BAGGEBO_SPEC.usableDepth * scale / width);
    return { ...entry, x:row.left + entry.x, height:height * fit, width:width * fit,
      y:row.bottom - height * fit / 2, depthInset:15 * scale };
  });
  return { ...layout, entries, rows, shelfType:'baggebo', unitWidth, unitCount,
    width:unitWidth * unitCount + unitGap * (unitCount - 1),
    height:BAGGEBO_SPEC.height * scale, depth:BAGGEBO_SPEC.depth * scale };
}
