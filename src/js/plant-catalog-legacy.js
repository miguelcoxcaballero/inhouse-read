import {getRustUI} from './rust-ui.js';
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
export {plantCatalogIllustration} from './plant-catalog-art.js';
let catalogSequence=0;
const afterPaint=work=>typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>setTimeout(work,0)):work();
// Soft hyphens at the compound seams of the longest names: on a narrow phone
// MUSKOTBLOMMA wraps as MUSKOT-/BLOMMA instead of shrinking or splitting at
// an arbitrary letter.
const NAME_SEAMS = { SANSEVIERIA:5, CHAMAEDOREA:6, NEPHROLEPIS:6, ZAMIOCULCAS:5, MUSKOTBLOMMA:6 };
const optionName = name => name.replace(/\S+/g, word =>
  NAME_SEAMS[word] ? `${word.slice(0, NAME_SEAMS[word])}\u00ad${word.slice(NAME_SEAMS[word])}` : word);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * `motionTarget()` returns the element holding the shelf room; the camera
 * flies from the booklet the catalogue was opened from into the page and
 * back. `onMotion('start'|'end')` brackets each flight. `onAdd`, `onAddLamp`
 * and `onShelfChange` receive `{ whenClosed }` to run their shelf update
 * once the closing flight has landed.
 */
export function createPlantCatalogLegacy({ onAdd, onAddLamp, onClose, onShelfChange, shelfType = 'walnut', motionTarget, onMotion } = {}, requestedId) {
  const id = requestedId || `ihr-plant-catalog-${++catalogSequence}`;
  const dialog = element('dialog','ihr-plant-catalog');
  dialog.dataset.testid = 'plant-catalog';
  dialog.setAttribute('aria-labelledby',`${id}-title`);
  dialog.setAttribute('aria-describedby',`${id}-description`);
  const paper = element('div','ihr-plant-catalog__paper');
  const header = element('header','ihr-plant-catalog__header');
  const brand = element('span','ihr-plant-catalog__brand');
  brand.setAttribute('role','img'); brand.setAttribute('aria-label','IKEA');
  brand.innerHTML = ikeaLogo.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
  const title = element('h2','ihr-plant-catalog__title','PLANTAS'); title.id = `${id}-title`;
  const closeButton = element('button','ihr-plant-catalog__close');
  closeButton.type = 'button'; closeButton.setAttribute('aria-label','Cerrar catálogo');
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  header.append(brand,title,closeButton);
  const description = element('p','ihr-plant-catalog__description','Planta, maceta y color'); description.hidden = true;
  description.id = `${id}-description`;
  const navigation = element('nav','ihr-plant-catalog__navigation');
  navigation.setAttribute('aria-label','Páginas del catálogo IKEA');
  const pageButtons = new Map();
  for (const [page,label] of [['plants','Plantas y macetas'],['shelves','Estanterías'],['lights','Iluminación']]) {
    const button = element('button','ihr-plant-catalog__page-tab',label);
    button.type = 'button'; button.dataset.catalogPage = page;
    button.setAttribute('aria-controls',`${id}-${page}`);
    button.addEventListener('click',() => switchPage(page));
    navigation.append(button); pageButtons.set(page,button);
  }
  const body = element('div','ihr-plant-catalog__body');
  body.id = `${id}-plants`;
  const preview = element('section','ihr-plant-catalog__preview');
  preview.setAttribute('aria-label','Planta y maceta seleccionadas');
  const drawing = element('div','ihr-plant-catalog__drawing');
  const previewCaption = element('div','ihr-plant-catalog__caption');
  const previewName = element('h3');
  const previewSubtitle = element('p');
  const previewPot = element('span','ihr-plant-catalog__pot-name');
  const previewColor = element('span','ihr-plant-catalog__color-caption');
  // Real IKEA size of this plant in this pot, in the style of the shelf's published measures.
  const previewSize = element('p','ihr-plant-catalog__plant-size');
  previewCaption.append(previewName,previewSubtitle,previewPot,previewColor,previewSize);
  preview.append(drawing,previewCaption);
  const choices = element('div','ihr-plant-catalog__choices');
  const plants = element('fieldset','ihr-plant-catalog__section');
  const plantsLegend = element('legend'); plantsLegend.innerHTML = '<span class="ihr-plant-catalog__step">1</span> Planta';
  const plantList = element('div','ihr-plant-catalog__plants');
  plants.append(plantsLegend,plantList);
  const pots = element('fieldset','ihr-plant-catalog__section ihr-plant-catalog__section--pots');
  const potsLegend = element('legend'); potsLegend.innerHTML = '<span class="ihr-plant-catalog__step">2</span> Maceta';
  const potList = element('div','ihr-plant-catalog__pots');
  pots.append(potsLegend,potList);
  const colors = element('fieldset','ihr-plant-catalog__section ihr-plant-catalog__section--colors');
  const colorsLegend = element('legend'); colorsLegend.innerHTML = '<span class="ihr-plant-catalog__step">3</span> Color';
  const colorList = element('div','ihr-plant-catalog__colors');
  colors.append(colorsLegend,colorList);
  choices.append(plants,pots,colors);
  body.append(preview,choices);
  const shelfBody = element('div','ihr-plant-catalog__body ihr-plant-catalog__body--shelves');
  shelfBody.id = `${id}-shelves`; shelfBody.hidden = true;
  const shelfPreview = element('section','ihr-plant-catalog__preview ihr-plant-catalog__shelf-preview');
  shelfPreview.setAttribute('aria-label','Estantería seleccionada en 3D');
  const shelfDrawing = element('div','ihr-plant-catalog__drawing ihr-plant-catalog__shelf-drawing');
  const shelfCaption = element('div','ihr-plant-catalog__caption');
  const shelfName = element('h3'), shelfSubtitle = element('p');
  const shelfDimensions = element('p','ihr-plant-catalog__shelf-dimensions');
  shelfCaption.append(shelfName,shelfSubtitle,shelfDimensions);
  shelfPreview.append(shelfDrawing,shelfCaption);
  const shelfChoices = element('fieldset','ihr-plant-catalog__shelf-choices');
  const shelfLegend = element('legend',null,'Estantería');
  const shelfList = element('div','ihr-plant-catalog__shelves');
  shelfChoices.append(shelfLegend,shelfList);
  shelfBody.append(shelfPreview,shelfChoices);
  const lampBody = element('div','ihr-plant-catalog__body ihr-plant-catalog__body--lights');
  lampBody.id = `${id}-lights`; lampBody.hidden = true;
  const lampPreview = element('section','ihr-plant-catalog__preview ihr-plant-catalog__lamp-preview');
  lampPreview.setAttribute('aria-label','Lámpara seleccionada en 3D');
  const lampDrawing = element('div','ihr-plant-catalog__drawing ihr-plant-catalog__lamp-drawing');
  const lampCaption = element('div','ihr-plant-catalog__caption');
  const lampName = element('h3'), lampSubtitle = element('p');
  const lampMount = element('p','ihr-plant-catalog__lamp-mount');
  lampCaption.append(lampName,lampSubtitle,lampMount);
  const kelvinList = element('div','ihr-plant-catalog__kelvins');
  kelvinList.setAttribute('role','group'); kelvinList.setAttribute('aria-label','Temperatura de color');
  lampPreview.append(lampDrawing,lampCaption,kelvinList);
  const lampChoices = element('fieldset','ihr-plant-catalog__lamp-choices');
  const lampLegend = element('legend',null,'Lámpara');
  const lampList = element('div','ihr-plant-catalog__lamps');
  lampChoices.append(lampLegend,lampList);
  lampBody.append(lampPreview,lampChoices);
  const footer = element('footer','ihr-plant-catalog__footer');
  const status = element('p','ihr-plant-catalog__status');
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const add = element('button','ihr-plant-catalog__add','Añadir');
  add.type = 'button'; add.dataset.catalogAdd = '';
  const pageNumber = element('span','ihr-plant-catalog__page-number','01 / 03');
  pageNumber.setAttribute('aria-hidden','true');
  footer.append(status,add,pageNumber);
  paper.append(header,navigation,description,body,shelfBody,lampBody,footer); dialog.append(paper); document.body.append(dialog);

  let selectedPlant = PLANT_CATALOG[0]?.id;
  let selectedPot = PLANT_CATALOG[0]?.defaultPotId || POT_CATALOG[0]?.id;
  let selectedColor = getPotColor(selectedPot).id;
  const rememberedColors = new Map();
  let preview3d = null, shelfPreview3d = null, lampPreview3d = null;
  let selectedLamp = LAMP_CATALOG[0]?.id, selectedKelvin = DEFAULT_LAMP_KELVIN;
  const kelvinButtons = new Map();
  let activePage = 'plants', savedShelf = normalizeShelfType(shelfType), selectedShelf = savedShelf;
  let trigger = null, destroyed = false, busy = false, opening = false, motion = null;
  const closedWork = [];
  const whenClosed = work => { if (typeof work === 'function') closedWork.push(work); };
  const plantButtons = new Map(), potButtons = new Map(), shelfButtons = new Map(), lampButtons = new Map();

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
  function update(){
    const catalogUI=getRustUI(),Candidate=catalogUI?.RustCatalogView;
    if(!Candidate||typeof Candidate.prototype.render!=='function'||typeof Candidate.prototype.syncColors!=='function')return legacyUpdate();
    try{
    const plant=getCatalogPlant(selectedPlant),pot=getCatalogPot(selectedPot),type=getShelfType(selectedShelf),lamp=getCatalogLamp(selectedLamp);
    const shelf=activePage==='shelves',light=activePage==='lights';
    catalogView ||= new catalogUI.RustCatalogView(dialog);
    catalogView.render([activePage,String(selectedKelvin),selectedLamp,selectedShelf,savedShelf,selectedColor,selectedPlant,selectedPot,
      lamp?.name||'',lamp?.subtitle||'',lamp?.mount==='undershelf'?'Bajo la balda':'Sobre la balda',type.name,type.subtitle,
      type.dimensions?type.dimensions.width/10+' × '+type.dimensions.depth/10+' × '+type.dimensions.height/10+' cm':'A medida',
      plant?.name||'',plant?.subtitle||'',pot?.name||'',getPotColor(selectedPot,selectedColor).name,plantSizeLabel(selectedPlant,selectedPot),busy,
      shelf?typeof onShelfChange==='function':light?!!lamp&&typeof onAddLamp==='function':!!plant&&!!pot&&typeof onAdd==='function']);
    if(opening&&activePage==='plants')preview3d?.update({catalogId:selectedPlant,potId:selectedPot,potColorId:selectedColor});
    if(opening&&shelf)shelfPreview3d?.update({shelfType:selectedShelf});
    if(opening&&light)lampPreview3d?.update({lampId:selectedLamp,kelvin:selectedKelvin});

    }catch{catalogView?.free();catalogView=null;legacyUpdate();}
  }
  function legacyUpdate() {
    const plant = getCatalogPlant(selectedPlant), pot = getCatalogPot(selectedPot);
    const selectedType = getShelfType(selectedShelf);
    const shelfPage = activePage === 'shelves', lampPage = activePage === 'lights';
    const lamp = getCatalogLamp(selectedLamp);
    dialog.dataset.catalogPage = activePage;
    body.hidden = activePage !== 'plants'; shelfBody.hidden = !shelfPage; lampBody.hidden = !lampPage;
    title.textContent = shelfPage ? 'ESTANTERÍAS' : lampPage ? 'ILUMINACIÓN' : 'PLANTAS';
    description.textContent = shelfPage ? 'Estantería' : lampPage ? 'Lámpara' : 'Planta, maceta y color';
    pageNumber.textContent = shelfPage ? '02 / 03' : lampPage ? '03 / 03' : '01 / 03';
    for (const [page,button] of pageButtons) {
      button.setAttribute('aria-pressed',String(page === activePage)); button.disabled = busy;
    }
    if (opening && activePage === 'plants') preview3d?.update({ catalogId:selectedPlant,potId:selectedPot,potColorId:selectedColor });
    if (opening && shelfPage) shelfPreview3d?.update({ shelfType:selectedShelf });
    if (opening && lampPage) lampPreview3d?.update({ lampId:selectedLamp,kelvin:selectedKelvin });
    lampName.textContent = lamp?.name || '';
    lampSubtitle.textContent = lamp?.subtitle || '';
    for (const [kelvin,button] of kelvinButtons) { button.setAttribute('aria-pressed',String(kelvin === selectedKelvin)); button.disabled = busy; }
    lampMount.textContent = lamp?.mount === 'undershelf' ? 'Bajo la balda' : 'Sobre la balda';
    for (const [lampId,button] of lampButtons) {
      button.setAttribute('aria-pressed',String(lampId === selectedLamp)); button.disabled = busy;
    }
    shelfName.textContent = selectedType.name;
    shelfSubtitle.textContent = selectedType.subtitle;
    shelfDimensions.textContent = selectedType.dimensions
      ? `${selectedType.dimensions.width / 10} × ${selectedType.dimensions.depth / 10} × ${selectedType.dimensions.height / 10} cm`
      : 'A medida';
    for (const [type,button] of shelfButtons) {
      button.setAttribute('aria-pressed',String(type === selectedShelf)); button.disabled = busy;
      button.querySelector('.ihr-plant-catalog__shelf-current').textContent = type === savedShelf ? 'Actual' : '';
    }
    for (const button of colorList.querySelectorAll('button')) {
      button.setAttribute('aria-pressed',String(button.dataset.catalogColor === selectedColor)); button.disabled = busy;
    }
    previewName.textContent = plant?.name || '';
    previewSubtitle.textContent = plant?.subtitle || '';
    previewPot.textContent = pot?.name || '';
    previewColor.textContent = getPotColor(selectedPot,selectedColor).name;
    previewSize.textContent = plantSizeLabel(selectedPlant,selectedPot);
    for (const [key, button] of plantButtons) {
      button.setAttribute('aria-pressed',String(key === selectedPlant)); button.disabled = busy;
    }
    for (const [key, button] of potButtons) {
      button.setAttribute('aria-pressed',String(key === selectedPot)); button.disabled = busy;
    }
    add.disabled = busy || (shelfPage ? typeof onShelfChange !== 'function'
      : lampPage ? !lamp || typeof onAddLamp !== 'function' : !plant || !pot || typeof onAdd !== 'function');
    add.textContent = shelfPage ? (busy ? 'Cambiando…' : 'Usar') : (busy ? 'Añadiendo…' : 'Añadir');
    if (shelfPage) add.dataset.catalogShelfAdd = '';
    else delete add.dataset.catalogShelfAdd;
    if (lampPage) add.dataset.catalogLampAdd = '';
    else delete add.dataset.catalogLampAdd;
    dialog.setAttribute('aria-busy',String(busy));
  }

  for (const plant of PLANT_CATALOG) {
    const button = element('button','ihr-plant-catalog__plant');
    button.type = 'button'; button.dataset.catalogPlant = plant.id;
    button.setAttribute('aria-label',`${plant.name}, ${plant.subtitle}`);
    const thumbnail = element('span','ihr-plant-catalog__thumbnail');
    thumbnail.innerHTML = plantCatalogIllustration(plant.id,plant.defaultPotId,{ compact:true });
    button.append(thumbnail,element('span','ihr-plant-catalog__option-name',optionName(plant.name)));
    button.addEventListener('click',() => {
      if (busy) return;
      selectedPlant = plant.id;
      status.textContent = ''; status.removeAttribute('data-error'); update();
    });
    plantList.append(button); plantButtons.set(plant.id,button);
  }
  for (const pot of POT_CATALOG) {
    const button = element('button','ihr-plant-catalog__pot');
    button.type = 'button'; button.dataset.catalogPot = pot.id;
    button.setAttribute('aria-label',`${pot.name}, ${pot.subtitle}`);
    const thumbnail = element('span','ihr-plant-catalog__pot-thumbnail');
    thumbnail.innerHTML = plantCatalogIllustration(selectedPlant,pot.id,{ potOnly:true,compact:true });
    button.append(thumbnail,element('span','ihr-plant-catalog__option-name',optionName(pot.name)));
    button.addEventListener('click',() => {
      if (busy) return;
      rememberedColors.set(selectedPot,selectedColor);
      selectedPot = pot.id;
      selectedColor = getPotColor(selectedPot,rememberedColors.get(selectedPot)).id;
      buildColors();
      status.textContent = ''; status.removeAttribute('data-error'); update();
    });
    potList.append(button); potButtons.set(pot.id,button);
  }
  for (const type of SHELF_TYPES) {
    const button = element('button','ihr-plant-catalog__shelf');
    button.type = 'button'; button.dataset.catalogShelf = type.id;
    button.setAttribute('aria-label',`${type.name}, ${type.subtitle}`);
    const icon = element('span','ihr-plant-catalog__shelf-icon');
    icon.innerHTML = type.id === 'baggebo'
      ? '<svg viewBox="0 0 64 96" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 90V5h43v85M8 5l6-3h43v85M51 5l6-3M8 31h43l6-3H14M8 56h43l6-3H14M8 80h43l6-3H14M14 2v85M27 31v22m3-22v22m3-22v22m3-22v22m3-22v22m3-22v22"/></svg>'
      : '<svg viewBox="0 0 64 96" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M7 90V7h43v83H7Zm0-83 7-4h43v83l-7 4M50 7l7-4M11 11h35v74H11V11Zm0 23h35M11 59h35M11 82h35M19 11v23m9-23v23m9-23v23m-18 2v23m9-23v23m9-23v23m-18 2v23m9-23v23m9-23v23"/></svg>';
    const caption = element('span','ihr-plant-catalog__shelf-option-caption');
    const dimensions = type.dimensions
      ? `${type.dimensions.width / 10} × ${type.dimensions.depth / 10} × ${type.dimensions.height / 10} cm`
      : 'A medida';
    caption.append(element('strong',null,type.name),element('span',null,type.subtitle),element('span',null,dimensions),element('span','ihr-plant-catalog__shelf-current'));
    button.append(icon,caption);
    button.addEventListener('click',() => {
      if (busy) return;
      selectedShelf = type.id; status.textContent = ''; status.removeAttribute('data-error'); update();
    });
    shelfList.append(button); shelfButtons.set(type.id,button);
  }

  for (const lamp of LAMP_CATALOG) {
    const button = element('button','ihr-plant-catalog__lamp');
    button.type = 'button'; button.dataset.catalogLamp = lamp.id;
    button.setAttribute('aria-label',`${lamp.name}, ${lamp.mount === 'undershelf' ? 'foco bajo balda' : 'lámpara de sobremesa'}`);
    const icon = element('span','ihr-plant-catalog__lamp-icon');
    icon.innerHTML = lampCatalogIllustration(lamp.id);
    const caption = element('span','ihr-plant-catalog__lamp-option-caption');
    caption.append(element('strong',null,lamp.name),element('span',null,lamp.subtitle),
      element('span','ihr-plant-catalog__lamp-installation',lamp.mount === 'undershelf' ? 'Bajo la balda' : 'Sobre la balda'));
    button.append(icon,caption);
    button.addEventListener('click',() => {
      if (busy) return;
      selectedLamp = lamp.id; status.textContent = ''; status.removeAttribute('data-error'); update();
    });
    lampList.append(button); lampButtons.set(lamp.id,button);
  }

  for (const kelvin of LAMP_KELVINS) {
    const button = element('button','ihr-plant-catalog__kelvin');
    button.type = 'button'; button.dataset.catalogKelvin = String(kelvin);
    const swatch = element('span','ihr-plant-catalog__kelvin-swatch');
    swatch.style.background = kelvinSwatch(kelvin);
    button.append(swatch,element('span',null,`${kelvin} K`));
    button.addEventListener('click',() => {
      if (busy) return;
      selectedKelvin = kelvin; status.textContent = ''; status.removeAttribute('data-error'); update();
    });
    kelvinList.append(button); kelvinButtons.set(kelvin,button);
  }

  function buildColors() {
    colorList.replaceChildren();
    for (const color of getPotColors(selectedPot)) {
      const button = element('button','ihr-plant-catalog__color');
      button.type = 'button'; button.dataset.catalogColor = color.id;
      button.setAttribute('aria-label',`Color ${color.name}`);
      const swatch = element('span','ihr-plant-catalog__swatch');
      swatch.style.backgroundColor = color.hex; swatch.setAttribute('aria-hidden','true');
      button.append(swatch,element('span','ihr-plant-catalog__color-name',color.name));
      button.addEventListener('click',() => {
        if (busy) return;
        selectedColor = color.id; rememberedColors.set(selectedPot,color.id);
        status.textContent = ''; status.removeAttribute('data-error'); update();
      });
      colorList.append(button);
    }
    catalogView?.syncColors();
  }

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
  buildColors(); update();
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
      close({ instant:true }); closedWork.length = 0; destroyed = true; disposePreviews(); catalogView?.free();catalogView=null; dialog.remove();
    }
  };
}
