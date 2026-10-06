import { LAMP_KELVINS } from './lamp-kelvin.js';

/** Millimetres; the tripod is a compact interpretation of the supplied photo.
 * `light` names the lights a fixture needs in the room (see shelf-lamp-lighting),
 * known before its model exists so scrolling never changes the shader. */
export const LAMP_CATALOG = Object.freeze([
  {
    id:'mittled', name:'MITTLED', title:'Foco bajo balda',
    subtitle:'Aluminio', mount:'undershelf',
    dimensions:Object.freeze({ width:68,height:11,depth:68 }), warmKelvin:2700, light:'cone',
    referenceUrl:'https://www.ikea.com/es/es/search/?q=MITTLED'
  },
  {
    id:'tarnaby', name:'TÄRNABY', title:'Farol retro',
    subtitle:'Cristal y latón', mount:'standing',
    dimensions:Object.freeze({ width:150,height:250,depth:150 }), warmKelvin:2700, light:'filaments:4',
    referenceUrl:'https://www.ikea.com/es/es/search/?q=T%C3%84RNABY'
  },
  {
    id:'tripod', name:'TRÍPODE', title:'Madera y lino',
    subtitle:'Madera y lino', mount:'standing',
    dimensions:Object.freeze({ width:180,height:280,depth:180 }), warmKelvin:2700, light:'cone',
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
    key,seed,lampId:lamp.id,isOn:candidate.isOn !== false,
    ...(Number.isFinite(candidate.shelf) && candidate.shelf >= 0
      ? { shelf:Math.min(999,Math.floor(candidate.shelf)) } : {}),
    ...(Number.isFinite(candidate.x) ? { x:Math.min(1,Math.max(0,candidate.x)) } : {}),
    // Older records carry none: the lamp's own 2700 K.
    ...(LAMP_KELVINS.includes(candidate.kelvin) ? { kelvin:candidate.kelvin } : {})
  };
}
