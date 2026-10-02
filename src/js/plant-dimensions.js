import { BAGGEBO_SPEC } from './shelf-types.js';

/**
 * Real sizes of every plant and pot on the shelf: THE one place to correct a
 * number. Units are millimetres, like BAGGEBO_SPEC and the lamp catalogue;
 * `shelfScale` turns them into scene pixels, so a 12 cm pot is a 12 cm pot
 * next to a book and a BAGGEBO shelf whatever the screen.
 *
 * IKEA names a live plant by the diameter of the nursery pot it is sold in
 * (6, 9, 12, 15, 17, 21, 24 cm) and lists "altura de la planta" counted from
 * the base of that pot. The four pots in the catalogue exist in a 12 cm
 * class. The product pages could not be opened while writing this table, so
 * every value comes from IKEA's published size classes and typical listings;
 * `confidence` says how sure each one is (alta, media, baja). Nothing here is
 * stretched to fit a shelf: where a species is too tall in its 12 cm class
 * for the tightest shelf, IKEA's 9 cm class of the same species is shown.
 */

/** Outer diameter of the 12 cm pot class, shared by every pot model. */
export const POT_DIAMETER_MM = 120;

/**
 * Pots, `height` is the outer height of the ceramic or steel body,
 * `footprint` the widest part standing on the board (a saucer, for MUSKOTBLOMMA).
 */
export const POT_SIZES = Object.freeze({
  muskot:{ diameter:POT_DIAMETER_MM, height:110, footprint:POT_DIAMETER_MM, confidence:'media',
    source:'MUSKOT maceta 12 cm (la ficha turca del referenceUrl lo nombra "12 cm"); altura de la serie 12 cm' },
  muskotblomma:{ diameter:POT_DIAMETER_MM, height:105, footprint:143, confidence:'baja',
    source:'MUSKOTBLOMMA 12 cm con plato; el plato ensancha la base un 19 %, como en el modelo 3D' },
  akerbar:{ diameter:POT_DIAMETER_MM, height:110, footprint:POT_DIAMETER_MM, confidence:'baja',
    source:'ÅKERBÄR macetero galvanizado clase 12 cm' },
  gradvis:{ diameter:POT_DIAMETER_MM, height:125, footprint:POT_DIAMETER_MM, confidence:'baja',
    source:'GRADVIS macetero de gres con estrías, clase 12 cm; algo más alto que los demás' }
});

/**
 * Plants: for each species the IKEA size classes (nursery pot in cm) with the
 * total height (mm, pot base to highest leaf) and the canopy `width` (mm).
 * IKEA publishes the height only; the canopy is estimated from the species.
 */
export const PLANT_SIZES = Object.freeze({
  sansevieria:{ confidence:'baja', classes:{ 12:{ height:350, width:150 }, 9:{ height:250, width:120 } },
    source:'SANSEVIERIA mezcla de especies; 12 cm unos 35 cm, 9 cm unos 25 cm' },
  monstera:{ confidence:'baja', classes:{ 12:{ height:280, width:170 }, 9:{ height:200, width:140 } },
    source:'MONSTERA DELICIOSA; 12 cm unos 28 cm, 9 cm unos 20 cm' },
  chamaedorea:{ confidence:'baja', classes:{ 12:{ height:400, width:250 }, 9:{ height:280, width:200 } },
    source:'CHAMAEDOREA ELEGANS; 12 cm unos 40 cm, 9 cm unos 28 cm' },
  nephrolepis:{ confidence:'baja', classes:{ 12:{ height:280, width:260 }, 9:{ height:200, width:200 } },
    source:'NEPHROLEPIS; 12 cm unos 28 cm, 9 cm unos 20 cm' },
  hedera:{ confidence:'baja', classes:{ 12:{ height:320, width:240 }, 9:{ height:240, width:180 } },
    source:'HEDERA HELIX; 12 cm unos 32 cm con guías, 9 cm unos 24 cm' },
  zamioculcas:{ confidence:'baja', classes:{ 12:{ height:380, width:170 }, 9:{ height:280, width:130 } },
    source:'ZAMIOCULCAS; 12 cm unos 38 cm, 9 cm unos 28 cm' },
  succulent:{ confidence:'media', classes:{ 12:{ height:150, width:140 }, 9:{ height:110, width:110 } },
    source:'SUCCULENT mezcla de especies; 12 cm unos 15 cm, 9 cm unos 11 cm' },
  cactus:{ confidence:'baja', classes:{ 12:{ height:240, width:120 }, 9:{ height:170, width:100 } },
    source:'FEJKA cactus artificial; 12 cm unos 24 cm, 9 cm unos 17 cm' }
});

/** Free height (mm) between a shelf board and the underside of the one above. */
export const SHELF_CLEARANCE_MM = Object.freeze({
  // Boards 3.75 mm thick under the next surface: the smallest of the three
  // BAGGEBO compartments (155 to 800 mm from the floor, see BAGGEBO_SPEC).
  baggebo:Math.min(...BAGGEBO_SPEC.shelfBottoms.map((bottom, slot) =>
    bottom - (slot ? BAGGEBO_SPEC.shelfBottoms[slot - 1] : 0) - 3.75)),
  // 'Madera' has no published size: it follows the book scale below. The top
  // compartment (bookmark room 48 + row, minus the 12 px of cabinet top) is the
  // tightest: 208 px on a phone (172 px rows), 236 px on a wide screen (200 px
  // rows), over 172 and 200 px for a 280 mm book: 339 mm and 330 mm. The
  // lower ones add the 16 px board and 24 px padding, minus 15 px: 245 and 273 px.
  walnut:Math.round(Math.min(208 / (172 / 280), 236 / (200 / 280)))
});

/** Plants never go above this, so that every one fits the tightest shelf with
 * the same margin the books keep (4 mm) and a little air for the leaves. */
export const PLANT_MAX_HEIGHT_MM = 300;

/** Largest IKEA size class of a species that fits under PLANT_MAX_HEIGHT_MM
 * (the smallest class, flagged `fits:false`, if none does). */
export function standardPlantClass(plantId) {
  const species = PLANT_SIZES[plantId];
  if (!species) return null;
  const sizes = Object.keys(species.classes).map(Number).sort((a, b) => b - a);
  const chosen = sizes.find(size => species.classes[size].height <= PLANT_MAX_HEIGHT_MM) ?? sizes.at(-1);
  const { height, width } = species.classes[chosen];
  return { potClass:chosen, height, width, fits:height <= PLANT_MAX_HEIGHT_MM };
}

/** Real dimensions (mm) of one plant standing in one pot. `width` is its slot
 * on the board: the canopy, or the pot with its saucer if that is wider. */
export function plantDimensions(plantId, potId) {
  const plant = standardPlantClass(plantId), pot = POT_SIZES[potId] || POT_SIZES.muskot;
  if (!plant) return null;
  const width = Math.max(plant.width, pot.footprint);
  // Depth on the board: the slot's 0.7 proportion, but never less than the round pot.
  return { height:plant.height, canopy:plant.width, width, depth:Math.max(width * .7, pot.footprint),
    potDiameter:pot.diameter, potHeight:pot.height, potFootprint:pot.footprint, potClass:plant.potClass };
}

/** "Maceta Ø12 cm · planta 25 cm", the wording of the catalogue. */
export function plantSizeLabel(plantId, potId) {
  const size = plantDimensions(plantId, potId);
  if (!size) return '';
  const cm = value => String(Math.round(value) / 10).replace('.', ',');
  return `Maceta Ø${cm(size.potDiameter)} cm · planta ${cm(size.height)} cm`;
}

/** Book height at its tallest (heightRatio 1): 28 cm, as baggeboLayout draws it. */
export const BOOK_REFERENCE_MM = 280;
const WALNUT_BOOK_PX = viewportWidth => viewportWidth >= 600 ? 200 : 172;

/**
 * Scene pixels per millimetre. On BAGGEBO the 600 mm unit fills the shelf
 * width, the scale lamps and books already use. 'Madera' has no published
 * size, so a 28 cm book is the full 172 px (200 px on wide screens) row.
 */
export function shelfScale({ shelfType, shelfWidth, viewportWidth = 0 } = {}) {
  if (shelfType === 'baggebo' && shelfWidth > 0) return shelfWidth / BAGGEBO_SPEC.width;
  return WALNUT_BOOK_PX(viewportWidth) / BOOK_REFERENCE_MM;
}

/** Plant size in scene pixels for a scale from `shelfScale`. */
export function plantSceneSize(plantId, potId, scale) {
  const size = plantDimensions(plantId, potId);
  return size ? { width:size.width * scale, height:size.height * scale, depth:size.depth * scale } : null;
}
