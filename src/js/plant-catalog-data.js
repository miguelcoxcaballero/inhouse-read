/** Shelf sized interpretations of the IKEA references, not physical dimensions. */
export const PLANT_CATALOG = Object.freeze([
  { id:'sansevieria', name:'SANSEVIERIA', subtitle:'Lengua de suegra · hojas verticales', variant:'sansevieria', width:54, height:124, defaultPotId:'muskot', referenceUrl:'https://www.ikea.com/es/es/p/sansevieria-planta-mezcla-especies-plantas-50597549/' },
  { id:'monstera', name:'MONSTERA DELICIOSA', subtitle:'Cerimán · hojas recortadas', variant:'monstera', width:92, height:126, defaultPotId:'gradvis', referenceUrl:'https://www.ikea.com/es/es/p/monstera-deliciosa-planta-ceriman-50515493/' },
  { id:'chamaedorea', name:'CHAMAEDOREA ELEGANS', subtitle:'Palmera de salón · frondas finas', variant:'chamaedorea', width:88, height:136, defaultPotId:'muskot', referenceUrl:'https://www.ikea.com/es/es/p/chamaedorea-elegans-planta-palmera-salon-90392763/' },
  { id:'nephrolepis', name:'NEPHROLEPIS', subtitle:'Helecho · frondas arqueadas', variant:'nephrolepis', width:94, height:104, defaultPotId:'akerbar', referenceUrl:'https://www.ikea.com/es/es/p/nephrolepis-planta-helecho-00630773/' },
  { id:'hedera', name:'HEDERA HELIX', subtitle:'Hiedra · ramas colgantes', variant:'hedera', width:88, height:106, defaultPotId:'muskotblomma', referenceUrl:'https://www.ikea.com/es/es/p/hedera-helix-planta-hiedra-66804047/' },
  { id:'zamioculcas', name:'ZAMIOCULCAS', subtitle:'Tallos erguidos · hojas brillantes', variant:'zamioculcas', width:76, height:136, defaultPotId:'gradvis', referenceUrl:'https://www.ikea.com/es/es/p/zamioculcas-planta-zamioculcas-50598681/' },
  { id:'succulent', name:'SUCCULENT', subtitle:'Suculenta · roseta carnosa', variant:'succulent', width:66, height:72, defaultPotId:'muskotblomma', referenceUrl:'https://www.ikea.com/es/es/p/succulent-planta-mezcla-especies-plantas-suculenta-10311006/' },
  { id:'cactus', name:'FEJKA', subtitle:'Cactus · columnas y espinas', variant:'cactus', width:56, height:90, defaultPotId:'akerbar', referenceUrl:'https://www.ikea.com/es/es/p/fejka-planta-artificial-interior-exterior-cactus-60587154/' },
].map(Object.freeze));

export const POT_CATALOG = Object.freeze([
  { id:'muskot', name:'MUSKOT', subtitle:'Cerámica blanca · anillos horizontales', referenceUrl:'https://www.ikea.com.tr/en/product/muskot-white-12-cm-earthenware-plant-pot-50308196' },
  { id:'muskotblomma', name:'MUSKOTBLOMMA', subtitle:'Terracota · maceta con plato', referenceUrl:'https://www.ikea.com/es/es/p/muskotblomma-maceta-con-plato-interior-exterior-terracota-00454883/' },
  { id:'akerbar', name:'ÅKERBÄR', subtitle:'Acero galvanizado · borde enrollado', referenceUrl:'https://www.ikea.com/es/es/p/akerbar-macetero-interior-exterior-galvanizado-50497696/' },
  { id:'gradvis', name:'GRADVIS', subtitle:'Gres rosa · estrías verticales', referenceUrl:'https://www.ikea.com/es/es/p/gradvis-macetero-rosa-60414078/' },
].map(Object.freeze));

const plantsById = new Map(PLANT_CATALOG.map(item => [item.id,item]));
const potsById = new Map(POT_CATALOG.map(item => [item.id,item]));
export const getCatalogPlant = id => plantsById.get(String(id || '')) ?? null;
export const getCatalogPot = id => potsById.get(String(id || '')) ?? null;
