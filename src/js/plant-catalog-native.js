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

import {plantCatalogIllustration} from './plant-catalog-legacy.js';
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
 */
export function createPlantCatalogNative({ onAdd, onAddLamp, onClose, onShelfChange, shelfType = 'walnut', motionTarget, onMotion } = {}, requestedId, catalogUI) {
  const id = requestedId || `ihr-plant-catalog-${++catalogSequence}`;
const dialog=catalogUI.catalog_build(document,id,ikeaLogo.replace('<svg ','<svg aria-hidden="true" focusable="false" '),catalogueOptions());
const paper=dialog.querySelector(".ihr-plant-catalog__paper");
const closeButton=dialog.querySelector(".ihr-plant-catalog__close");
const body=dialog.querySelector(".ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights)");
const drawing=dialog.querySelector(".ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights) .ihr-plant-catalog__drawing");
const shelfDrawing=dialog.querySelector(".ihr-plant-catalog__drawing.ihr-plant-catalog__shelf-drawing");
const lampDrawing=dialog.querySelector(".ihr-plant-catalog__drawing.ihr-plant-catalog__lamp-drawing");
const status=dialog.querySelector(".ihr-plant-catalog__status");
const add=dialog.querySelector(".ihr-plant-catalog__add");


  let selectedPlant = PLANT_CATALOG[0]?.id;
  let selectedPot = PLANT_CATALOG[0]?.defaultPotId || POT_CATALOG[0]?.id;
  let selectedColor = getPotColor(selectedPot).id;
  const rememberedColors = new Map();
  let preview3d = null, shelfPreview3d = null, lampPreview3d = null;
  let selectedLamp = LAMP_CATALOG[0]?.id, selectedKelvin = DEFAULT_LAMP_KELVIN;
  let activePage = 'plants', savedShelf = normalizeShelfType(shelfType), selectedShelf = savedShelf;
  let trigger = null, destroyed = false, busy = false, opening = false, motion = null;
  const closedWork = [];
  const whenClosed = work => { if (typeof work === 'function') closedWork.push(work); };

  function disposePreviews() {
    preview3d?.dispose(); preview3d = null;
    shelfPreview3d?.dispose(); shelfPreview3d = null;
    lampPreview3d?.dispose(); lampPreview3d = null;
  }
  function suspendPreviews() {
    preview3d?.setActive(false);
    shelfPreview3d?.setActive(false);
    lampPreview3d?.setActive(false);
  }
  function mountPreview() {
    if (!opening || destroyed) return;
    // Each page is created on its first visit. Retaining its model/environment
    // avoids recompiling the same studio when navigating or reopening the book.
    // Only the visible page can request a draw; destroy releases all three.
    suspendPreviews();
    if (activePage === 'plants') {
      preview3d ||= createPlantCatalogPreview(drawing);
      preview3d.setActive(true);
    } else if (activePage === 'shelves') {
      shelfPreview3d ||= createShelfCatalogPreview(shelfDrawing);
      shelfPreview3d.setActive(true);
    } else {
      lampPreview3d ||= createLampCatalogPreview(lampDrawing);
      lampPreview3d.setActive(true);
    }
  }
  function switchPage(page) {
    if (busy || destroyed || activePage === page) return;
    activePage = page;
    status.textContent = ''; status.removeAttribute('data-error');
    update(); mountPreview(); update();
  }

  let catalogView=null;
  function update() {

    const plant=getCatalogPlant(selectedPlant),pot=getCatalogPot(selectedPot),type=getShelfType(selectedShelf),lamp=getCatalogLamp(selectedLamp);
    const shelf=activePage==='shelves',light=activePage==='lights';
    if(!catalogView){catalogView=new catalogUI.RustCatalogView(dialog);catalogView.connect(select);}
    catalogView.render([activePage,String(selectedKelvin),selectedLamp,selectedShelf,savedShelf,selectedColor,selectedPlant,selectedPot,
      lamp?.name||'',lamp?.subtitle||'',lamp?.mount==='undershelf'?'Bajo la balda':'Sobre la balda',type.name,type.subtitle,
      type.dimensions?type.dimensions.width/10+' × '+type.dimensions.depth/10+' × '+type.dimensions.height/10+' cm':'A medida',
      plant?.name||'',plant?.subtitle||'',pot?.name||'',getPotColor(selectedPot,selectedColor).name,plantSizeLabel(selectedPlant,selectedPot),busy,
      shelf?typeof onShelfChange==='function':light?!!lamp&&typeof onAddLamp==='function':!!plant&&!!pot&&typeof onAdd==='function']);
    if(opening&&activePage==='plants')preview3d?.update({catalogId:selectedPlant,potId:selectedPot,potColorId:selectedColor});
    if(opening&&shelf)shelfPreview3d?.update({shelfType:selectedShelf});
    if(opening&&light)lampPreview3d?.update({lampId:selectedLamp,kelvin:selectedKelvin});
  }


  function select(kind,id){
    if(kind==='page'){switchPage(id);return}if(busy)return;
    if(kind==='plant')selectedPlant=id;
    else if(kind==='pot'){rememberedColors.set(selectedPot,selectedColor);selectedPot=id;selectedColor=getPotColor(selectedPot,rememberedColors.get(selectedPot)).id;buildColors();}
    else if(kind==='shelf')selectedShelf=id;
    else if(kind==='lamp')selectedLamp=id;
    else if(kind==='kelvin')selectedKelvin=Number(id);
    else if(kind==='color'){selectedColor=id;rememberedColors.set(selectedPot,id);}
    else return;
    status.textContent='';status.removeAttribute('data-error');update();
  }
  function buildColors(){catalogUI.catalog_colors(dialog,getPotColors(selectedPot).flatMap(color=>['color',color.id,'Color '+color.name,'',color.name,'','','',color.hex]).join('\0'));catalogView?.syncColors();}
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
  function fly(phase,frames,done) {
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
      motion = null;
      // The page closes first: the room's repaint (a new lamp's shaders can
      // take a while) must never keep the catalogue on screen.
      try { if (!quiet) done(); } finally { afterPaint(() => onMotion?.('end')); }
    };
    motion = { phase,land };
    room.finished.then(() => land(),() => {});
    // A hidden tab may never finish the animation; never strand the dialog.
    const guard = () => {
      if (room.playState === 'running' && document.visibilityState !== 'hidden') safety = setTimeout(guard,250);
      else land();
    };
    safety = setTimeout(guard,CATALOG_CAMERA_MS + 400);
  }
  function finishClose() {
    if (!opening) return;
    // Closed from elsewhere mid-flight: just put the room back.
    motion?.land({ quiet:true });
    opening = false;
    delete dialog.dataset.catalogCamera;
    suspendPreviews();
    onClose?.();
    // The closed page paints first; the shelf's own update (a new lamp's
    // shaders can take long) follows, never holding the page on screen.
    const works = closedWork.splice(0);
    if (works.length) afterPaint(() => {
      for (const work of works) {
        try { work(); } catch (error) { console.warn('No se pudo actualizar la estantería:',error); }
      }
    });
    if (trigger?.isConnected) trigger.focus({ preventScroll:true });
    trigger = null;
  }
  function closeNow() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    finishClose();
  }
  function close({ instant = false } = {}) {
    if (destroyed || !opening) return;
    if (motion?.phase === 'closing') { if (instant) motion.land(); return; }
    motion?.land();
    const frames = !instant && cameraFrames(trigger);
    if (!frames) { closeNow(); return; }
    // Nothing redraws inside the page while it flies back into the booklet.
    suspendPreviews();
    fly('closing',frames,closeNow);
  }
  closeButton.addEventListener('click',() => close());
  dialog.addEventListener('cancel',event => { event.preventDefault(); close(); });
  dialog.addEventListener('close',finishClose);
  dialog.addEventListener('click',event => {
    if (event.target !== dialog) return;
    const bounds = paper.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  dialog.addEventListener('keydown',event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    // Native <dialog> also traps focus; this keeps the fallback usable.
    if (event.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll('button:not(:disabled)')].filter(button => !button.closest('[hidden]'));
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  add.addEventListener('click',async () => {
    const shelfPage = activePage === 'shelves', lampPage = activePage === 'lights';
    if (busy || (shelfPage ? typeof onShelfChange !== 'function'
      : lampPage ? typeof onAddLamp !== 'function' : typeof onAdd !== 'function')) return;
    busy = true; status.textContent = ''; status.removeAttribute('data-error'); update();
    try {
      // The shelf saves now and redraws once the page has flown back.
      if (shelfPage) {
        await onShelfChange({ shelfType:selectedShelf },{ whenClosed });
        savedShelf = selectedShelf;
      } else if (lampPage) await onAddLamp({ lampId:selectedLamp,kelvin:selectedKelvin },{ whenClosed });
      else await onAdd({ catalogId:selectedPlant, potId:selectedPot,potColorId:selectedColor },{ whenClosed });
      if (!destroyed) close();
    } catch {
      if (!destroyed) {
        status.dataset.error = 'true';
        status.textContent = shelfPage ? 'No se pudo cambiar. Reintenta.' : lampPage
          ? 'No se pudo añadir. Reintenta.' : 'No se pudo añadir. Reintenta.';
      }
    } finally {
      busy = false;
      if (!destroyed) update();
    }
  });
  try{buildColors();update();}catch(error){catalogView?.free();disposePreviews();throw error;}
  document.body.append(dialog);
  return {
    open(from = document.activeElement) {
      if (destroyed || opening) return;
      trigger = from instanceof HTMLElement ? from : null;
      selectedShelf = savedShelf; activePage = 'plants';
      opening = true; status.textContent = ''; status.removeAttribute('data-error');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open',''); dialog.setAttribute('aria-modal','true'); }
      const frames = cameraFrames(trigger);
      update();
      // A studio prepared earlier only draws; a first one is created after
      // the flight so its setup never competes with the camera move.
      if (!frames || preview3d) mountPreview();
      update();
      body.scrollTop = 0; closeButton.focus({ preventScroll:true });
      if (frames) fly('opening',frames,() => { if (opening && !destroyed) { mountPreview(); update(); } });
    },
    /** Idle-time preparation: the plant studio and its shaders before the first open. */
    prepare() {
      if (destroyed || opening || preview3d) return;
      preview3d = createPlantCatalogPreview(drawing);
      preview3d.setActive(false);
      preview3d.update({ catalogId:selectedPlant,potId:selectedPot,potColorId:selectedColor });
      preview3d.prepare?.();
    },
    setShelfType(value) {
      savedShelf = normalizeShelfType(value); selectedShelf = savedShelf;
      if (!destroyed) update();
    },
    close,
    destroy() {
      if (destroyed) return;
      close({ instant:true }); closedWork.length = 0; destroyed = true; disposePreviews();catalogView?.free();catalogView=null;dialog.remove();
    }
  };
}
