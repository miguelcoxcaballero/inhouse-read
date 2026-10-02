import { BAGGEBO_SPEC } from './shelf-types.js';

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

/** Free height (mm) between a shelf board and the underside of the one above. */
export const SHELF_CLEARANCE_MM = Object.freeze({
  // Clearance includes the 16.5 mm rim under the preceding surface: smallest
  // BAGGEBO compartments (155 to 800 mm from the floor, see BAGGEBO_SPEC).
  baggebo:Math.min(...BAGGEBO_SPEC.shelfBottoms.map((bottom, slot) =>
    bottom - (slot ? BAGGEBO_SPEC.shelfBottoms[slot - 1] + BAGGEBO_SPEC.shelfRimHeight : BAGGEBO_SPEC.postSize))),
  // 'Madera' has no published size: it follows the book scale below. The top
  // compartment (bookmark room 48 + row, minus the 12 px of cabinet top) is the
  // tightest: 208 px on a phone (172 px rows), 236 px on a wide screen (200 px
  // rows), over 172 and 200 px for a 280 mm book: 339 mm and 330 mm. The
  // lower ones add the 16 px board and 24 px padding, minus 15 px: 245 and 273 px.
  walnut:Math.round(Math.min(208 / (172 / 280), 236 / (200 / 280)))
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
