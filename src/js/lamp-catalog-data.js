/** Millimetres; the tripod is a compact interpretation of the supplied photo. */
export const LAMP_CATALOG = Object.freeze([
  {
    id:'mittled', name:'MITTLED', title:'Foco bajo balda',
    description:'Foco circular de aluminio con difusor opalino. Se fija al techo de la leja.',
    subtitle:'Bajo la balda · aluminio y luz cálida', mount:'undershelf',
    dimensions:Object.freeze({ width:68,height:11,depth:68 }), warmKelvin:2700,
    referenceUrl:'https://www.ikea.com/es/es/search/?q=MITTLED'
  },
  {
    id:'tarnaby', name:'TÄRNABY', title:'Farol retro',
    description:'Metal negro, latón y cristal transparente con una bombilla LED de filamento ámbar.',
    subtitle:'Sobre la balda · cristal y LED retro', mount:'standing',
    dimensions:Object.freeze({ width:150,height:250,depth:150 }), warmKelvin:2700,
    referenceUrl:'https://www.ikea.com/es/es/search/?q=T%C3%84RNABY'
  },
  {
    id:'tripod', name:'TRÍPODE', title:'Madera y lino',
    description:'Tres patas de madera clara y una pantalla cilíndrica de lino. Versión compacta para la estantería.',
    subtitle:'Sobre la balda · madera y lino', mount:'standing',
    dimensions:Object.freeze({ width:180,height:280,depth:180 }), warmKelvin:2700,
    referenceUrl:'https://www.ikea.com/es/es/search/?q=LAUTERS'
  }
].map(Object.freeze));

const byId = new Map(LAMP_CATALOG.map(lamp => [lamp.id,lamp]));
export const getCatalogLamp = id => byId.get(String(id || '')) ?? null;

/** Keep placement independent of screen pixels and reject unknown fixtures. */
export function normalizeShelfLamp(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const lamp = getCatalogLamp(candidate.lampId);
  const key = typeof candidate.key === 'string' && candidate.key.trim() ? candidate.key.trim()
    : typeof candidate.seed === 'string' && candidate.seed.trim() ? candidate.seed.trim() : null;
  if (!lamp || !key) return null;
  const seed = typeof candidate.seed === 'string' && candidate.seed.trim() ? candidate.seed.trim() : key;
  return {
    key,seed,lampId:lamp.id,
    ...(Number.isFinite(candidate.shelf) && candidate.shelf >= 0
      ? { shelf:Math.min(999,Math.floor(candidate.shelf)) } : {}),
    ...(Number.isFinite(candidate.x) ? { x:Math.min(1,Math.max(0,candidate.x)) } : {})
  };
}
