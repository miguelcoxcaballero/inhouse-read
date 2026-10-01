import ikeaLogo from '../assets/ikea-logo.svg?raw';
import { createPlantCatalogPreview } from './plant-catalog-preview.js';
import { PLANT_CATALOG, POT_CATALOG, getCatalogPlant, getCatalogPot, getPotColors, getPotColor } from './plant-catalog-data.js';

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

export function createPlantCatalog({ onAdd, onClose } = {}) {
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
  const description = element('p','ihr-plant-catalog__description','Elige una planta y una maceta para tu estantería.');
  description.id = `${id}-description`;
  const body = element('div','ihr-plant-catalog__body');
  const preview = element('section','ihr-plant-catalog__preview');
  preview.setAttribute('aria-label','Planta y maceta seleccionadas');
  const drawing = element('div','ihr-plant-catalog__drawing');
  const previewCaption = element('div','ihr-plant-catalog__caption');
  const previewName = element('h3');
  const previewSubtitle = element('p');
  const previewPot = element('span','ihr-plant-catalog__pot-name');
  const previewColor = element('span','ihr-plant-catalog__color-caption');
  previewCaption.append(previewName,previewSubtitle,previewPot,previewColor);
  preview.append(drawing,previewCaption);
  const choices = element('div','ihr-plant-catalog__choices');
  const plants = element('fieldset','ihr-plant-catalog__section');
  const plantsLegend = element('legend'); plantsLegend.innerHTML = '<span class="ihr-plant-catalog__step">1</span> Elige la planta';
  const plantList = element('div','ihr-plant-catalog__plants');
  plants.append(plantsLegend,plantList);
  const pots = element('fieldset','ihr-plant-catalog__section ihr-plant-catalog__section--pots');
  const potsLegend = element('legend'); potsLegend.innerHTML = '<span class="ihr-plant-catalog__step">2</span> Elige la maceta';
  const potList = element('div','ihr-plant-catalog__pots');
  pots.append(potsLegend,potList);
  const colors = element('fieldset','ihr-plant-catalog__section ihr-plant-catalog__section--colors');
  const colorsLegend = element('legend'); colorsLegend.innerHTML = '<span class="ihr-plant-catalog__step">3</span> Elige el color';
  const colorList = element('div','ihr-plant-catalog__colors');
  colors.append(colorsLegend,colorList);
  choices.append(plants,pots,colors);
  body.append(preview,choices);
  const footer = element('footer','ihr-plant-catalog__footer');
  const status = element('p','ihr-plant-catalog__status');
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const add = element('button','ihr-plant-catalog__add','Añadir a la estantería');
  add.type = 'button'; add.dataset.catalogAdd = '';
  const pageNumber = element('span','ihr-plant-catalog__page-number','01 / 01');
  pageNumber.setAttribute('aria-hidden','true');
  footer.append(status,add,pageNumber);
  paper.append(header,description,body,footer); dialog.append(paper); document.body.append(dialog);

  let selectedPlant = PLANT_CATALOG[0]?.id;
  let selectedPot = PLANT_CATALOG[0]?.defaultPotId || POT_CATALOG[0]?.id;
  let selectedColor = getPotColor(selectedPot).id;
  const rememberedColors = new Map();
  let preview3d = null;
  let trigger = null, destroyed = false, busy = false, opening = false;
  const plantButtons = new Map(), potButtons = new Map();

  function update() {
    const plant = getCatalogPlant(selectedPlant), pot = getCatalogPot(selectedPot);
    preview3d?.update({ catalogId:selectedPlant,potId:selectedPot,potColorId:selectedColor });
    for (const button of colorList.querySelectorAll('button')) {
      button.setAttribute('aria-pressed',String(button.dataset.catalogColor === selectedColor)); button.disabled = busy;
    }
    previewName.textContent = plant?.name || '';
    previewSubtitle.textContent = plant?.subtitle || '';
    previewPot.textContent = pot?.name || '';
    previewColor.textContent = getPotColor(selectedPot,selectedColor).name;
    for (const [key, button] of plantButtons) {
      button.setAttribute('aria-pressed',String(key === selectedPlant)); button.disabled = busy;
    }
    for (const [key, button] of potButtons) {
      button.setAttribute('aria-pressed',String(key === selectedPot)); button.disabled = busy;
    }
    add.disabled = busy || !plant || !pot || typeof onAdd !== 'function';
    add.textContent = busy ? 'Añadiendo…' : 'Añadir a la estantería';
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

  function finishClose() {
    if (!opening) return;
    opening = false;
    preview3d?.dispose(); preview3d = null;
    onClose?.();
    if (trigger?.isConnected) trigger.focus({ preventScroll:true });
    trigger = null;
  }
  function close() {
    if (destroyed || !opening) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    finishClose();
  }
  closeButton.addEventListener('click',close);
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
    const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  add.addEventListener('click',async () => {
    if (busy || typeof onAdd !== 'function') return;
    busy = true; status.textContent = ''; status.removeAttribute('data-error'); update();
    try {
      await onAdd({ catalogId:selectedPlant, potId:selectedPot,potColorId:selectedColor });
      if (!destroyed) close();
    } catch {
      if (!destroyed) {
        status.dataset.error = 'true';
        status.textContent = 'No se pudo añadir la planta. Vuelve a intentarlo.';
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
      opening = true; status.textContent = ''; status.removeAttribute('data-error');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open',''); dialog.setAttribute('aria-modal','true'); }
      preview3d = createPlantCatalogPreview(drawing); update();
      body.scrollTop = 0; closeButton.focus({ preventScroll:true });
    },
    close,
    destroy() {
      if (destroyed) return;
      close(); destroyed = true; dialog.remove();
    }
  };
}
