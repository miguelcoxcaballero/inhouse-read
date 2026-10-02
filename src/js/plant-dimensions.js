import { BAGGEBO_SPEC, SHELF_SPECS } from './shelf-types.js';

/** Canonical centimetres. IKEA's “12 cm” is the maximum nursery pot,
 * not the outer diameter. Product measurements checked 2026-10-02.
 * Each row confidence covers nursery class and height; every canopy width
 * has low confidence (botanical estimate), not a published IKEA measurement.
 * Heights vary naturally with living plants.
 * Unavailable compact variants remain explicitly low confidence, never
 * presented as verified product measurements. Millimetres below are adapters
 * for the existing shelf API, not a second independently maintained table. */
const product = path => `https://www.ikea.com/es/es/p/${path}/`;
export const IKEA_SIZES_CM = Object.freeze({
  pots:{
    muskot:{ nursery:12, diameter:15, height:14, footprint:15, confidence:'alta',
      source:'https://www.ikea.com.tr/en/product/muskot-white-12-cm-earthenware-plant-pot-50308196' },
    muskotblomma:{ nursery:12, diameter:16, height:13, footprint:16, confidence:'alta',
      source:product('muskotblomma-maceta-con-plato-interior-exterior-terracota-00454883') },
    gradvis:{ nursery:12, diameter:13, height:12, footprint:13, confidence:'alta',
      source:product('gradvis-macetero-rosa-60414078') },
    akerbar:{ nursery:12, diameter:14, height:12, footprint:14, confidence:'baja',
      source:product('akerbar-macetero-interior-exterior-galvanizado-50497696'),
      note:'Referencia de 24 cm; variante de 12 cm y cotas exteriores pendientes de verificar.' }
  },
  plants:{
    sansevieria:{ nursery:9, height:25, width:15, widthConfidence:'baja', confidence:'baja',
      source:product('sansevieria-planta-mezcla-especies-plantas-50597549'), note:'La ficha es de 21 cm y no publica altura; variante compacta estimada.' },
    monstera:{ nursery:12, height:35, width:26, widthConfidence:'baja', confidence:'alta',
      source:product('monstera-deliciosa-planta-ceriman-50515493') },
    chamaedorea:{ nursery:9, height:20, width:20, widthConfidence:'baja', confidence:'alta',
      source:product('chamaedorea-elegans-planta-palmera-salon-90392763') },
    nephrolepis:{ nursery:9, height:17, width:20, widthConfidence:'baja', confidence:'media',
      source:product('nephrolepis-planta-helecho-00630773'), note:'Follaje publicado 10 cm; envolvente con maceta decorativa estimada en 17 cm.' },
    hedera:{ nursery:9, height:24, width:18, widthConfidence:'baja', confidence:'baja',
      source:product('hedera-helix-planta-hiedra-66804047'), note:'Ficha de 13 cm y 35 cm de altura; variante compacta estimada, no verificada.' },
    zamioculcas:{ nursery:9, height:28, width:17, widthConfidence:'baja', confidence:'baja',
      source:product('zamioculcas-planta-zamioculcas-50598681'), note:'Ficha de 17 cm y 55 cm de altura; variante compacta estimada, no verificada.' },
    succulent:{ nursery:9, height:16, width:14, widthConfidence:'baja', confidence:'media',
      source:product('succulent-planta-mezcla-especies-plantas-suculenta-10311006'), note:'Follaje publicado 9 cm; envolvente decorativa estimada en 16 cm.' },
    cactus:{ nursery:6, height:18, width:12, widthConfidence:'baja', confidence:'media',
      source:product('fejka-planta-artificial-interior-exterior-cactus-60587154'), note:'Artículo publicado de 14 cm; envolvente con maceta decorativa estimada en 18 cm.' }
  }
});
export const POT_DIAMETER_MM = 120; // nursery class only
export const POT_SIZES = Object.freeze(Object.fromEntries(Object.entries(IKEA_SIZES_CM.pots).map(([id,p]) =>
  [id, { ...p, diameter:p.diameter*10, height:p.height*10, footprint:p.footprint*10 }])));
export const PLANT_SIZES = Object.freeze(Object.fromEntries(Object.entries(IKEA_SIZES_CM.plants).map(([id,p]) =>
  [id, { ...p, widthConfidence:'baja', classes:{ [p.nursery]:{ height:p.height*10, width:p.width*10 } } }])));

/** Free height (mm) between a shelf board and the underside of the one above.
 * Clearance includes the rim under the preceding surface: the smallest
 * compartment of each cabinet (155 to 800 mm from the floor). Both types are
 * built to the same 600 x 250 x 1160 mm spec, so the figures agree. */
const clearanceOf = spec => Math.min(...spec.shelfBottoms.map((bottom, slot) =>
  bottom - (slot ? spec.shelfBottoms[slot - 1] + spec.shelfRimHeight : spec.postSize)));
export const SHELF_CLEARANCE_MM = Object.freeze({
  baggebo:clearanceOf(SHELF_SPECS.baggebo),
  walnut:clearanceOf(SHELF_SPECS.walnut)
});

/** Plants above this conservative interior limit use the open roof, keeping
 * their measured size. The limit includes the 4 mm margin used by books. */
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

/** Outer pot diameter × height, plant height and confidence in the catalogue. */
export function plantSizeLabel(plantId, potId) {
  const size = plantDimensions(plantId, potId);
  if (!size) return '';
  const cm = value => String(Math.round(value) / 10).replace('.', ',');
  const estimated = PLANT_SIZES[plantId].confidence !== 'alta' || POT_SIZES[potId]?.confidence !== 'alta';
  const unverified = PLANT_SIZES[plantId].confidence === 'baja' || POT_SIZES[potId]?.confidence === 'baja';
  const placement = size.height > PLANT_MAX_HEIGHT_MM ? ' · sobre el mueble' : '';
  return `Maceta Ø${cm(size.potDiameter)} × ${cm(size.potHeight)} cm · planta ${cm(size.height)} cm${estimated ? ' aprox.' : ''}${unverified ? ' (sin verificar)' : ''}${placement}`;
}

/** Book height at its tallest (heightRatio 1): 24 cm; spineStyleFor varies it
 * down to 80 % (19.2 cm), a typical 21-22 cm paperback or hardback. */
export const BOOK_REFERENCE_MM = 240;
/** Spine thickness of a real book: a slim paperback to a thick hardback. */
export const BOOK_THICKNESS_MM = Object.freeze({ min:15, max:45 });
/** Depth of a standing book: its cover width, 13-16 cm for a hardback. */
export const BOOK_DEPTH_MM = Object.freeze({ min:130, max:160 });

/** `spineStyleFor` options that draw real thicknesses, in pixels for a shelf
 * `shelfWidth` px wide (a 600 mm unit): 15-45 mm, so a row of 56 cm holds
 * roughly 12-18 books instead of two. */
export function bookSpineOptions(shelfWidth) {
  const scale = shelfScale({ shelfWidth });
  return { minWidth:BOOK_THICKNESS_MM.min * scale, maxWidth:BOOK_THICKNESS_MM.max * scale, jitter:4 * scale };
}

/** A thin real spine is hard to tap: its layout cell (and so its hit area)
 * is never narrower than this many pixels, even if the drawn book is. */
export function minimumBookCellWidth(viewportWidth = 0) { return viewportWidth >= 600 ? 18 : 16; }

/**
 * Scene pixels per millimetre. Both shelves are 600 mm wide units that fill
 * the shelf width, the scale lamps, books and plants use. Without a measured
 * width (a DOM-only fallback) a 600 mm unit is assumed 390 px wide.
 */
export function shelfScale({ shelfWidth } = {}) {
  return (shelfWidth > 0 ? shelfWidth : 390) / BAGGEBO_SPEC.width;
}

/** Plant size in scene pixels for a scale from `shelfScale`. */
export function plantSceneSize(plantId, potId, scale) {
  const size = plantDimensions(plantId, potId);
  return size ? { width:size.width * scale, height:size.height * scale, depth:size.depth * scale } : null;
}
