import { PLANT_SIZES, POT_SIZES, plantDimensions } from './plant-dimensions.js';

/** `width` and `height` are the real IKEA size in millimetres (the standard
 * class shown on the shelf); the table lives in plant-dimensions.js. */
const PLANT_REFERENCES = Object.freeze([
  { id:'sansevieria', name:'SANSEVIERIA', subtitle:'Lengua de suegra', variant:'sansevieria', defaultPotId:'muskot', referenceUrl:'https://www.ikea.com/es/es/p/sansevieria-planta-mezcla-especies-plantas-50597549/' },
  { id:'monstera', name:'MONSTERA DELICIOSA', subtitle:'Cerimán', variant:'monstera', defaultPotId:'gradvis', referenceUrl:'https://www.ikea.com/es/es/p/monstera-deliciosa-planta-ceriman-50515493/' },
  { id:'chamaedorea', name:'CHAMAEDOREA ELEGANS', subtitle:'Palmera de salón', variant:'chamaedorea', defaultPotId:'muskot', referenceUrl:'https://www.ikea.com/es/es/p/chamaedorea-elegans-planta-palmera-salon-90392763/' },
  { id:'nephrolepis', name:'NEPHROLEPIS', subtitle:'Helecho', variant:'nephrolepis', defaultPotId:'akerbar', referenceUrl:'https://www.ikea.com/es/es/p/nephrolepis-planta-helecho-00630773/' },
  { id:'hedera', name:'HEDERA HELIX', subtitle:'Hiedra', variant:'hedera', defaultPotId:'muskotblomma', referenceUrl:'https://www.ikea.com/es/es/p/hedera-helix-planta-hiedra-66804047/' },
  { id:'zamioculcas', name:'ZAMIOCULCAS', subtitle:'Planta ZZ', variant:'zamioculcas', defaultPotId:'gradvis', referenceUrl:'https://www.ikea.com/es/es/p/zamioculcas-planta-zamioculcas-50598681/' },
  { id:'succulent', name:'SUCCULENT', subtitle:'Suculenta', variant:'succulent', defaultPotId:'muskotblomma', referenceUrl:'https://www.ikea.com/es/es/p/succulent-planta-mezcla-especies-plantas-suculenta-10311006/' },
  { id:'cactus', name:'FEJKA', subtitle:'Cactus', variant:'cactus', defaultPotId:'akerbar', referenceUrl:'https://www.ikea.com/es/es/p/fejka-planta-artificial-interior-exterior-cactus-60587154/' },
]);

export const PLANT_CATALOG = Object.freeze(PLANT_REFERENCES.map(plant => {
  const size = plantDimensions(plant.id, plant.defaultPotId);
  return Object.freeze({ ...plant, width:size.width, height:size.height, canopy:size.canopy, potClass:size.potClass,
    confidence:PLANT_SIZES[plant.id].confidence });
}));

const POT_REFERENCES = Object.freeze([
  { id:'muskot', name:'MUSKOT', subtitle:'Cerámica blanca', referenceUrl:'https://www.ikea.com.tr/en/product/muskot-white-12-cm-earthenware-plant-pot-50308196' },
  { id:'muskotblomma', name:'MUSKOTBLOMMA', subtitle:'Terracota con plato', referenceUrl:'https://www.ikea.com/es/es/p/muskotblomma-maceta-con-plato-interior-exterior-terracota-00454883/' },
  { id:'akerbar', name:'ÅKERBÄR', subtitle:'Acero galvanizado', referenceUrl:'https://www.ikea.com/es/es/p/akerbar-macetero-interior-exterior-galvanizado-50497696/' },
  { id:'gradvis', name:'GRADVIS', subtitle:'Gres rosa', referenceUrl:'https://www.ikea.com/es/es/p/gradvis-macetero-rosa-60414078/' },
]);

export const POT_CATALOG = Object.freeze(POT_REFERENCES.map(pot => Object.freeze({ ...pot,
  diameter:POT_SIZES[pot.id].diameter, height:POT_SIZES[pot.id].height, footprint:POT_SIZES[pot.id].footprint })));

const plantsById = new Map(PLANT_CATALOG.map(item => [item.id,item]));
const potsById = new Map(POT_CATALOG.map(item => [item.id,item]));
export const getCatalogPlant = id => plantsById.get(String(id || '')) ?? null;
export const getCatalogPot = id => potsById.get(String(id || '')) ?? null;

// Finish palettes are material choices, rather than a universal colour picker.
export const POT_COLORS = Object.freeze(Object.fromEntries(Object.entries({
  muskot:[['ivory','Marfil','#efece4'],['sage','Salvia','#9ead98'],['blue','Azul porcelana','#829dac'],['charcoal','Carbón','#484a48']],
  muskotblomma:[['terracotta','Terracota','#b36a48'],['sand','Arcilla arena','#c6a17a'],['red-clay','Arcilla roja','#944e37'],['dark-clay','Arcilla oscura','#715448']],
  akerbar:[['zinc','Zinc','#cfd3d5'],['graphite','Grafito','#646b70'],['copper','Cobre','#be896c'],['bronze','Bronce','#a49466']],
  gradvis:[['rose','Rosa','#dcb7b3'],['cream','Crema','#d9ceb9'],['seafoam','Verde agua','#97b1aa'],['slate','Azul pizarra','#81949e']],
}).map(([potId, colors]) => [potId,Object.freeze(colors.map(([id,name,hex]) => Object.freeze({id,name,hex})))])));
export const getPotColors = potId => POT_COLORS[potId] || POT_COLORS.muskot;
export const getPotColor = (potId, colorId) => getPotColors(potId).find(color => color.id === colorId) || getPotColors(potId)[0];
