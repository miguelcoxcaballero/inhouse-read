let cataloguePacket;function catalogueOptions(){if(cataloguePacket!==undefined)return cataloguePacket;
const catalogueRows=[];
for(const plant of PLANT_CATALOG)catalogueRows.push(['plant',plant.id,plant.name+', '+plant.subtitle,plantCatalogIllustration(plant.id,plant.defaultPotId,{compact:true}),optionName(plant.name),'','','','']);
for(const pot of POT_CATALOG)catalogueRows.push(['pot',pot.id,pot.name+', '+pot.subtitle,plantCatalogIllustration(PLANT_CATALOG[0]?.id,pot.id,{potOnly:true,compact:true}),optionName(pot.name),'','','','']);
for(const type of SHELF_TYPES)catalogueRows.push(['shelf',type.id,type.name+', '+type.subtitle,shelfIcon(type.id),type.name,type.subtitle,type.dimensions?type.dimensions.width/10+' × '+type.dimensions.depth/10+' × '+type.dimensions.height/10+' cm':'A medida','','']);
for(const lamp of LAMP_CATALOG)catalogueRows.push(['lamp',lamp.id,lamp.name+', '+(lamp.mount==='undershelf'?'foco bajo balda':'lámpara de sobremesa'),lampCatalogIllustration(lamp.id),lamp.name,lamp.subtitle,'',lamp.mount==='undershelf'?'Bajo la balda':'Sobre la balda','']);
for(const kelvin of LAMP_KELVINS)catalogueRows.push(['kelvin',String(kelvin),'','',kelvin+' K','','','',kelvinSwatch(kelvin)]);
return cataloguePacket=catalogueRows.flat().join('\0');}
function shelfIcon(id){return id === 'baggebo'
      ? '<svg viewBox="0 0 64 96" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 90V5h43v85M8 5l6-3h43v85M51 5l6-3M8 31h43l6-3H14M8 56h43l6-3H14M8 80h43l6-3H14M14 2v85M27 31v22m3-22v22m3-22v22m3-22v22m3-22v22m3-22v22"/></svg>'
      : '<svg viewBox="0 0 64 96" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M7 90V7h43v83H7Zm0-83 7-4h43v83l-7 4M50 7l7-4M11 11h35v74H11V11Zm0 23h35M11 59h35M11 82h35M19 11v23m9-23v23m9-23v23m-18 2v23m9-23v23m9-23v23m-18 2v23m9-23v23m9-23v23"/></svg>';}
import ikeaLogo from '../assets/ikea-logo.svg?raw';
import { createPlantCatalogPreview } from './plant-catalog-preview.js';
import { createShelfCatalogPreview } from './shelf-catalog-preview.js';
import { createLampCatalogPreview } from './lamp-catalog-preview.js';
import { LAMP_CATALOG, getCatalogLamp } from './lamp-catalog-data.js';
import { lampCatalogIllustration } from './lamp-illustration.js';
import { PLANT_CATALOG, POT_CATALOG, getCatalogPlant, getCatalogPot, getPotColors, getPotColor } from './plant-catalog-data.js';
import { SHELF_TYPES, getShelfType, normalizeShelfType } from './shelf-types.js';
import { DEFAULT_LAMP_KELVIN, LAMP_KELVINS, kelvinSwatch } from './lamp-kelvin.js';
import { plantSizeLabel } from './plant-dimensions.js';
import { CATALOG_CAMERA_EASING, CATALOG_CAMERA_MS, IDENTITY, bookletRect, catalogCameraFrames } from './catalog-camera.js';

import {plantCatalogIllustration} from './plant-catalog-art.js';
let catalogSequence=0;
const afterPaint=work=>typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>setTimeout(work,0)):work();
// Soft hyphens at the compound seams of the longest names: on a narrow phone
// MUSKOTBLOMMA wraps as MUSKOT-/BLOMMA instead of shrinking or splitting at
// an arbitrary letter.
const NAME_SEAMS = { SANSEVIERIA:5, CHAMAEDOREA:6, NEPHROLEPIS:6, ZAMIOCULCAS:5, MUSKOTBLOMMA:6 };
const optionName = name => name.replace(/\S+/g, word =>
  NAME_SEAMS[word] ? `${word.slice(0, NAME_SEAMS[word])}\u00ad${word.slice(NAME_SEAMS[word])}` : word);

/**
 * `motionTarget()` returns the element holding the shelf room; the camera
 * flies from the booklet the catalogue was opened from into the page and
 * back. `onMotion('start'|'end')` brackets each flight. `onAdd`, `onAddLamp`
 * and `onShelfChange` receive `{ whenClosed }` to run their shelf update
 * once the closing flight has landed.
 *
 * The Rust controller owns the state: selection, pages, the add flow, opening,
 * closing, keyboard and studio lifetimes. This host keeps what is not logic:
 * the catalogue tables, the three.js studios and the camera flight (Web Animations).
 */
export function createPlantCatalogNative({ onAdd, onAddLamp, onClose, onShelfChange, shelfType = 'walnut', motionTarget, onMotion } = {}, requestedId, catalogUI) {
  const id = requestedId || `ihr-plant-catalog-${++catalogSequence}`;
  const dialog = catalogUI.catalog_build(document, id, ikeaLogo.replace('<svg ', '<svg aria-hidden="true" focusable="false" '), catalogueOptions());
  const paper = dialog.querySelector('.ihr-plant-catalog__paper');
  const drawing = dialog.querySelector('.ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights) .ihr-plant-catalog__drawing');
  const shelfDrawing = dialog.querySelector('.ihr-plant-catalog__drawing.ihr-plant-catalog__shelf-drawing');
  const lampDrawing = dialog.querySelector('.ihr-plant-catalog__drawing.ihr-plant-catalog__lamp-drawing');

  function cameraFrames(from) {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof dialog.animate !== 'function' || !(from instanceof Element) || !from.isConnected || from.hidden) return null;
    const stage = typeof motionTarget === 'function' ? motionTarget() : null;
    if (!(stage instanceof Element) || typeof stage.animate !== 'function') return null;
    const booklet = bookletRect(from);
    // Only a booklet actually on screen can be flown into.
    if (booklet.bottom <= 0 || booklet.right <= 0 || booklet.top >= innerHeight || booklet.left >= innerWidth) return null;
    const frames = catalogCameraFrames(booklet,dialog.getBoundingClientRect(),stage.getBoundingClientRect());
    return frames && { ...frames,room:stage };
  }
  /** `ended()` tells the controller the flight no longer owns the dialog; `done()` runs once the page has landed. */
  function fly(phase,frames,done,ended) {
    const inward = phase === 'opening', stage = frames.room;
    const previous = { origin:stage.style.transformOrigin,willChange:stage.style.willChange };
    stage.style.transformOrigin = '0 0'; stage.style.willChange = 'transform';
    dialog.style.transformOrigin = '0 0';
    dialog.dataset.catalogCamera = phase;
    paper.inert = !inward;
    onMotion?.('start');
    // Transform and opacity only: the compositor runs the flight even while
    // the main thread prepares the page or the shelf.
    const timing = { duration:CATALOG_CAMERA_MS,easing:CATALOG_CAMERA_EASING,fill:'both' };
    const room = stage.animate(inward ? [{ transform:IDENTITY },{ transform:frames.stage }]
      : [{ transform:frames.stage },{ transform:IDENTITY }],timing);
    const page = dialog.animate(inward
      ? [{ transform:frames.page,opacity:0,offset:0 },{ opacity:1,offset:.32 },{ transform:IDENTITY,opacity:1,offset:1 }]
      : [{ transform:IDENTITY,opacity:1,offset:0 },{ opacity:1,offset:.68 },{ transform:frames.page,opacity:0,offset:1 }],timing);
    let landed = false, safety = 0;
    const land = ({ quiet = false } = {}) => {
      if (landed) return;
      landed = true; clearTimeout(safety);
      // The opaque page backdrop already hides the room: reset it unseen.
      if (inward) dialog.dataset.catalogCamera = 'in';
      else delete dialog.dataset.catalogCamera;
      room.cancel(); page.cancel();
      stage.style.transformOrigin = previous.origin; stage.style.willChange = previous.willChange;
      dialog.style.transformOrigin = '';
      paper.inert = false;
      ended();
      // The page closes first: the room's repaint (a new lamp's shaders can
      // take a while) must never keep the catalogue on screen.
      try { if (!quiet) done(); } finally { afterPaint(() => onMotion?.('end')); }
    };
    room.finished.then(() => land(),() => {});
    // A hidden tab may never finish the animation; never strand the dialog.
    const guard = () => {
      if (room.playState === 'running' && document.visibilityState !== 'hidden') safety = setTimeout(guard,250);
      else land();
    };
    safety = setTimeout(guard,CATALOG_CAMERA_MS + 400);
    return { phase,land };
  }

  const firstPlant = PLANT_CATALOG[0]?.id, firstPot = PLANT_CATALOG[0]?.defaultPotId || POT_CATALOG[0]?.id;
  const controller = new catalogUI.RustCatalogController(dialog, {
    // Static tables stay in JavaScript: one call answers every label the view paints.
    describe(plantId,potId,colorId,shelfId,lampId) {
      const plant = getCatalogPlant(plantId), pot = getCatalogPot(potId), type = getShelfType(shelfId), lamp = getCatalogLamp(lampId);
      return [lamp?.name || '',lamp?.subtitle || '',lamp?.mount === 'undershelf' ? 'Bajo la balda' : 'Sobre la balda',type.name,type.subtitle,
        type.dimensions ? type.dimensions.width / 10 + ' × ' + type.dimensions.depth / 10 + ' × ' + type.dimensions.height / 10 + ' cm' : 'A medida',
        plant?.name || '',plant?.subtitle || '',pot?.name || '',getPotColor(potId,colorId).name,plantSizeLabel(plantId,potId),!!plant,!!pot,!!lamp];
    },
    colorId:(potId,remembered) => getPotColor(potId,remembered).id,
    colorRows:potId => getPotColors(potId).flatMap(color => ['color',color.id,'Color ' + color.name,'',color.name,'','','',color.hex]).join('\0'),
    normalizeShelf:normalizeShelfType,
    createPreview:kind => kind === 'plants' ? createPlantCatalogPreview(drawing)
      : kind === 'shelves' ? createShelfCatalogPreview(shelfDrawing) : createLampCatalogPreview(lampDrawing),
    frames:cameraFrames, fly, afterPaint, onAdd, onAddLamp, onClose, onShelfChange
  }, { plant:firstPlant, pot:firstPot, color:getPotColor(firstPot).id, lamp:LAMP_CATALOG[0]?.id, kelvin:DEFAULT_LAMP_KELVIN, shelfType });
  document.body.append(dialog);
  let live = controller;
  return {
    open(from = document.activeElement) { live?.open(from); },
    /** Idle-time preparation: the plant studio and its shaders before the first open. */
    prepare() { live?.prepare(); },
    setShelfType(value) { live?.setShelfType(value); },
    close({ instant = false } = {}) { live?.close(Boolean(instant)); },
    destroy() {
      if (!live) return;
      const owner = live; live = null;
      try { owner.destroy(); } finally { owner.free(); }
    }
  };
}
