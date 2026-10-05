import ikeaLogo from '../assets/ikea-logo.svg?raw';
import { createPlantCatalogPreview } from './plant-catalog-preview.js';
import { createShelfCatalogPreview } from './shelf-catalog-preview.js';
import { createLampCatalogPreview } from './lamp-catalog-preview.js';
import { LAMP_CATALOG, getCatalogLamp } from './lamp-catalog-data.js';
import { lampCatalogIllustration } from './lamp-illustration.js';
import { PLANT_CATALOG, POT_CATALOG, getCatalogPlant, getCatalogPot, getPotColors, getPotColor } from './plant-catalog-data.js';
import { SHELF_TYPES, getShelfType, normalizeShelfType } from './shelf-types.js';
import { plantSizeLabel } from './plant-dimensions.js';
import { CATALOG_CAMERA_EASING, CATALOG_CAMERA_MS, IDENTITY, bookletRect, catalogCameraFrames } from './catalog-camera.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let catalogSequence = 0;

// Keep closed white silhouettes separate from open detail strokes: filling an
// open vein or rib makes SVG close it with an unintended diagonal edge.
const detail = d => `<path fill="none" stroke-width="1" d="${d}"/>`;
const outline = d => `<path fill="white" d="${d}"/>`;

function leaf(x, y, width, height, angle = 0, veins = true) {
  return `<g transform="translate(${x} ${y}) rotate(${angle})">${outline(`M0 0C${-width*.85} ${-height*.22} ${-width*.75} ${-height*.73} 0 ${-height}C${width*.66} ${-height*.76} ${width*.8} ${-height*.24} 0 0Z`)}${veins ? detail(`M0 -2Q${width*.06} ${-height*.48} 0 ${-height*.86}`) : ''}</g>`;
}

function potDrawing(id = 'muskot', { compact = false } = {}) {
  let body, lines;
  if (id === 'akerbar') {
    body = 'M55 146L61 177Q80 184 99 177L105 146Z';
    lines = 'M61 174Q80 181 99 174M99 151L95 173';
  } else if (id === 'muskotblomma') {
    body = 'M54 146L63 177Q80 184 97 177L106 146Z';
    lines = 'M56 152Q80 160 104 152';
  } else if (id === 'gradvis') {
    body = 'M56 146C56 160 57 174 64 179Q80 188 96 179C103 174 104 160 104 146Z';
    lines = 'M61 152Q61 170 67 179M68 154Q68 174 73 182M76 155L77 183M84 155L83 183M92 154Q92 174 87 182M99 152Q99 170 93 179';
  } else {
    body = 'M54 146L60 175Q61 181 80 183Q99 181 100 175L106 146Z';
    lines = compact ? 'M58 163Q80 173 102 163M60 172Q80 182 100 172'
      : 'M58 161Q80 171 102 161M59 166Q80 176 101 166M60 171Q80 181 100 171M61 176Q80 185 99 176';
  }
  const saucer = id === 'muskotblomma' ? `${outline('M50 183Q80 174 110 183L109 187Q80 196 51 187Z')}${detail('M51 183Q80 191 109 183')}` : '';
  // The front lip uses its own lower arc, never two competing ellipses.
  return `${saucer}${outline(body)}${detail(lines)}<ellipse fill="white" cx="80" cy="146" rx="${id === 'gradvis' ? 24 : id === 'akerbar' ? 25 : 26}" ry="5"/>${detail('M58 146Q80 152 102 146')}`;
}

function plantDrawing(id, { compact = false } = {}) {
  if (id === 'sansevieria') {
    return [[64,66,-18],[93,62,17],[71,37,-10],[87,30,9],[78,18,-2]].map(([x,tip,bend]) => {
      const contour = `M${x-4} 147C${x-7} 117 ${x+bend-6} ${tip+30} ${x+bend} ${tip}C${x+bend+5} ${tip+26} ${x+5} 116 ${x+4} 147Z`;
      return `${outline(contour)}${detail(`M${x} 142Q${x+bend-2} 82 ${x+bend} ${tip+13}`)}`;
    }).join('');
  }
  if (id === 'monstera') {
    const stems = detail('M78 147Q72 123 58 109M80 147Q94 128 106 117M79 146Q74 108 66 78M81 146Q87 107 94 80');
    const contour = 'M0 0C-9 7-28 0-29-14Q-31-23-26-30C-23-30-15-23-13-27Q-17-33-25-36Q-26-42-21-46C-17-46-12-38-9-40Q-12-49-17-51Q-10-60 0-64Q10-60 17-51Q12-49 9-40C12-38 17-46 21-46Q26-42 25-36Q17-33 13-27C15-23 23-30 26-30Q31-23 29-14C28 0 9 7 0 0Z';
    return stems + [[58,109,28,58,-33],[106,117,28,62,35],[66,78,24,56,-22],[94,80,27,65,25]].map(([x,y,w,h,a]) =>
      `<g transform="translate(${x} ${y}) rotate(${a}) scale(${w/30} ${h/64})">${outline(contour)}${detail('M0 0Q-1-29 0-55')}${compact ? '' : '<ellipse fill="none" stroke-width="1" cx="-7" cy="-19" rx="2.5" ry="4.5"/><ellipse fill="none" stroke-width="1" cx="7" cy="-19" rx="2.5" ry="4.5"/>'}</g>`).join('');
  }
  if (id === 'chamaedorea' || id === 'nephrolepis') {
    const fern = id === 'nephrolepis';
    // Fewer fronds at thumbnail scale, with separated, tapering leaflets.
    const fronds = fern ? [[-66,77],[-39,95],[-12,107],[17,102],[46,88],[70,71]] : [[-55,86],[-29,111],[0,126],[30,108],[57,83]];
    return fronds.map(([angle,length]) => {
      const pairs = fern ? (compact ? 7 : 10) : (compact ? 6 : 8);
      const foliage = Array.from({length:pairs},(_,j) => {
        const f = (j+1)/(pairs+1), y = -length*f;
        const size = Math.sin(f*Math.PI)**.7*(fern ? 15 : 23);
        return leaf(0,y,size*.23,size, -62,false)+leaf(0,y-2,size*.23,size,62,false);
      }).join('');
      return `<g transform="translate(80 146) rotate(${angle})">${detail(`M0 0Q-3 ${-length*.55} 0 ${-length}`)}${foliage}${leaf(0,-length+10,2.5,13,0,false)}</g>`;
    }).join('');
  }
  if (id === 'hedera') {
    const vines = [[68,142,-28,-56],[78,142,-7,-111],[88,142,36,-69],[99,140,32,22],[60,140,-31,25]];
    const silhouette = 'M0 0Q-5-3-12-4L-8-12L-13-18L-4-17L0-28L5-17L13-18L9-11L12-4Q5-3 0 0Z';
    return vines.map(([x,y,dx,dy],index) => detail(`M${x} ${y}Q${x+dx*.55} ${y+dy*.5} ${x+dx} ${y+dy}`) + Array.from({length:compact ? 3 : 4},(_,j) => {
      const f = (j+1)/(compact ? 3 : 4), lx=x+dx*f, ly=y+dy*f;
      return `<g transform="translate(${lx} ${ly}) rotate(${(j%2 ? 30 : -28)+index*4})">${outline(silhouette)}${detail(compact ? 'M0-2V-23' : 'M0-2V-23M0-12L-8-17M0-12L8-17')}</g>`;
    }).join('')).join('');
  }
  if (id === 'zamioculcas') {
    return [[64,144,-25,86],[79,145,-7,116],[90,144,17,106],[101,143,32,78]].map(([x,y,angle,length]) => {
      const pairs = compact ? 4 : 5;
      return `<g transform="translate(${x} ${y}) rotate(${angle})">${detail(`M0 0Q-2 ${-length*.55} 0 ${-length}`)}${Array.from({length:pairs},(_,j) => {
        const yy=-length*(j+1)/(pairs+1), size=1-j*.075;
        return leaf(0,yy,9*size,22*size,-57,!compact)+leaf(0,yy-3,9*size,22*size,57,!compact);
      }).join('')}${leaf(0,-length+8,6,17,0,!compact)}</g>`;
    }).join('');
  }
  if (id === 'succulent') {
    // A rosette seen from the front: layered fleshy leaves, no wheel of
    // superimposed radial outlines that turns into a dark knot at icon size.
    const layers = [[[-48,38,16],[-25,48,16],[0,53,15],[27,48,16],[51,37,16]],
      [[-65,26,17],[-34,35,17],[0,38,16],[35,34,17],[65,25,17]],
      [[-52,19,15],[0,24,14],[51,19,15]]];
    return layers.map((row,tier) => row.map(([a,h,w])=>leaf(80,145-tier*2,w,h,a,!compact)).join('')).join('');
  }
  if (id === 'cactus') {
    return [[59,147,11,55],[100,147,11,47],[80,147,14,105]].map(([x,y,r,h]) => {
      const body = `M${-r} 0V${-h+r}A${r} ${r} 0 0 1 ${r} ${-h+r}V0Z`;
      const ribs = `M${-r*.45} -3V${-h+r+2}M0 -3V${-h+7}M${r*.45} -3V${-h+r+2}`;
      const spines = Array.from({length:compact ? 4 : 6},(_,i) => {
        const yy=-12-i*(h-28)/(compact ? 4 : 6);
        return detail(`M${-r-1} ${yy}l-3-2M${r+1} ${yy-3}l3-2`);
      }).join('');
      return `<g transform="translate(${x} ${y})">${outline(body)}${detail(ribs)}${spines}</g>`;
    }).join('');
  }
  return plantDrawing('monstera',{compact});
}

/** Opaque silhouettes hide rear stems; fine open strokes describe the surface. */
export function plantCatalogIllustration(catalogId, potId = 'muskot', { potOnly = false, compact = false } = {}) {
  const viewBox = potOnly ? '42 136 76 62' : '0 0 160 200';
  return `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="${compact ? 1.65 : 1.3}" stroke-linecap="round" stroke-linejoin="round">${potOnly ? '' : plantDrawing(catalogId,{compact})}${potDrawing(potId,{compact})}</svg>`;
}

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
export function createPlantCatalog({ onAdd, onAddLamp, onClose, onShelfChange, shelfType = 'walnut', motionTarget, onMotion } = {}) {
  const id = `ihr-plant-catalog-${++catalogSequence}`;
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
  const lampWarmth = element('span','ihr-plant-catalog__lamp-warmth');
  const lampMount = element('p','ihr-plant-catalog__lamp-mount');
  lampCaption.append(lampName,lampSubtitle,lampWarmth,lampMount);
  lampPreview.append(lampDrawing,lampCaption);
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
  let selectedLamp = LAMP_CATALOG[0]?.id;
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

  function update() {
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
    if (opening && lampPage) lampPreview3d?.update({ lampId:selectedLamp });
    lampName.textContent = lamp?.name || '';
    lampSubtitle.textContent = lamp?.subtitle || '';
    lampWarmth.textContent = `${lamp?.warmKelvin || 2700} K`;
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
      onMotion?.('end');
      if (!quiet) done();
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
    for (const work of closedWork.splice(0)) {
      try { work(); } catch (error) { console.warn('No se pudo actualizar la estantería:',error); }
    }
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
      } else if (lampPage) await onAddLamp({ lampId:selectedLamp },{ whenClosed });
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
      close({ instant:true }); closedWork.length = 0; destroyed = true; disposePreviews(); dialog.remove();
    }
  };
}
