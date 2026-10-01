/** IKEA publishes the overall size; the component positions were checked
 * against its assembly drawings and public product-viewer geometry. Units: mm. */
export const BAGGEBO_SPEC = Object.freeze({
  articleNumber:'504.811.72',
  width:600,
  depth:250,
  height:1160,
  dimensions:Object.freeze({ width:600, depth:250, height:1160 }),
  material:'Acero con revestimiento de resina epoxi/poliéster en polvo',
  footMaterial:'Polipropileno',
  color:'Blanco',
  maxShelfLoadKg:12,
  postSize:18,
  innerWidth:564,
  usableDepth:220,
  shelfRimHeight:16.5,
  shelfBottoms:Object.freeze([360, 682.5, 1005]),
  shelfHeightsFromFloor:Object.freeze([800, 477.5, 155]),
  topMesh:true,
  meshSurfaceCount:4,
  rearBrace:Object.freeze({ width:216, height:320, top:376.51, bottom:696.51 }),
  meshPitch:Object.freeze({ width:13.2, height:7.2 }),
  provenance:Object.freeze({
    dimensions:'Medidas publicadas por IKEA: 60 × 25 × 116 cm.',
    structure:'Manual AA-2235400-4, páginas 6–9: cuatro montantes, tres baldas interiores, superficie superior de malla, refuerzo trasero y tacos regulables.',
    shelfPositions:'Geometría oficial IKEA: superficies a 155, 477.49, 799.99 y 1159.99 mm desde el suelo; redondeadas a 155, 477.5, 800 y 1160 mm.',
    rearBrace:'Geometría oficial IKEA: 216 × 320 mm, entre 463.49 y 783.49 mm desde el suelo.',
    smallDetails:'Perfiles de 18 mm y bordes de 16.5 mm medidos en el modelo oficial. Paso de malla, radios, pintura y detalles de tornillos aproximados a partir de las fotos y el manual.'
  }),
  sources:Object.freeze({
    product:'https://www.ikea.com/es/es/p/baggebo-estanteria-metal-blanco-50481172/',
    assembly:'https://www.ikea.com/es/es/assembly_instructions/baggebo-estanteria-metal-blanco__AA-2235400-4-2.pdf',
    detailPhoto:'https://www.ikea.com/es/es/images/products/baggebo-estanteria-metal-blanco__0981564_pe815397_s5.jpg',
    geometry:'https://web-api.ikea.com/dimma/assets/1.2/50481172/PS01_S01_NV01/iqp3/glb/9b8fe0cb424d4ed3b7812cbffd83695f-50481172_PS01_S01_NV01_IQP3_2.0.glb?cn=pip'
  })
});

export const SHELF_TYPES = Object.freeze([
  Object.freeze({ id:'walnut', name:'Madera', subtitle:'Nogal', dimensions:null }),
  Object.freeze({ id:'baggebo', name:'BAGGEBO', subtitle:'Metal blanco', dimensions:BAGGEBO_SPEC.dimensions })
]);

export function normalizeShelfType(id) {
  const normalized = typeof id === 'string' ? id.trim().toLowerCase() : '';
  return SHELF_TYPES.some(type => type.id === normalized) ? normalized : 'walnut';
}

export function getShelfType(id) {
  return SHELF_TYPES.find(type => type.id === normalizeShelfType(id));
}
