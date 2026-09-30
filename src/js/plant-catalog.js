import { PLANT_CATALOG, POT_CATALOG, getCatalogPlant, getCatalogPot } from './plant-catalog-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let catalogSequence = 0;

function leaf(x, y, width, height, angle = 0) {
  return `<path transform="translate(${x} ${y}) rotate(${angle})" d="M0 0C${-width} ${-height * .25} ${-width * .6} ${-height * .8} 0 ${-height}C${width * .6} ${-height * .8} ${width} ${-height * .25} 0 0ZM0 0V${-height * .85}"/>`;
}

function potDrawing(id = 'muskot', { compact = false } = {}) {
  if (id === 'akerbar') return '<ellipse cx="80" cy="146" rx="25" ry="6"/><ellipse cx="80" cy="145" rx="23" ry="4"/><path d="M55 146L60 180Q80 187 100 180L105 146M60 177Q80 184 100 177M99 146L95 175M80 141V144"/>';
  if (id === 'muskotblomma') return '<ellipse cx="80" cy="146" rx="26" ry="6"/><path d="M54 145L63 179Q80 185 97 179L106 145M56 151Q80 158 104 151M59 160L64 176M101 160L96 176"/><ellipse cx="80" cy="184" rx="30" ry="5"/><path d="M50 183V187Q80 195 110 187V183"/>';
  if (id === 'gradvis') return '<ellipse cx="80" cy="146" rx="24" ry="6"/><path d="M56 146Q56 176 65 182Q80 187 95 182Q104 176 104 146M61 151Q61 176 68 181M68 152Q68 177 73 183M76 152V184M84 152V184M92 152Q92 177 87 183M99 151Q99 176 92 181"/>';
  const ribs = compact ? '<path d="M58 164Q80 173 102 164M59 171Q80 179 101 171"/>' : '<path d="M58 162Q80 171 102 162M59 166Q80 175 101 166M59 170Q80 179 101 170M60 174Q80 182 100 174"/>';
  return `<ellipse cx="80" cy="146" rx="26" ry="6"/><path d="M54 146L60 177Q80 188 100 177L106 146M60 177Q80 183 100 177"/>${ribs}`;
}

function plantDrawing(id) {
  if (id === 'sansevieria') {
    return Array.from({ length:7 }, (_, index) => {
      const x = 61 + index * 6, tip = [52,27,43,15,35,49,63][index];
      const bend = [-13,-8,-5,2,9,12,17][index];
      return `<path d="M${x - 3} 145Q${x - 9} 98 ${x + bend} ${tip}Q${x + 11} 100 ${x + 4} 145ZM${x} 139Q${x - 1} 87 ${x + bend} ${tip + 12}"/>`;
    }).join('') + '<path d="M57 90L62 94M65 64L70 68M73 103L77 107M84 67L88 71M94 105L98 109M89 46L93 50"/>';
  }
  if (id === 'monstera') {
    const leaves = [[80,139,33,70,-38],[82,119,32,75,34],[74,105,27,69,-32],[84,91,28,65,39],[80,71,25,62,-7]];
    return '<path d="M80 147Q80 97 83 51M79 139L50 100M81 119L112 81M77 105L48 64M83 92L118 47"/>' + leaves.map(([x,y,w,h,a]) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M0 0C${-w} ${-h * .2} ${-w} ${-h * .6} ${-w * .4} ${-h * .76}L${-w * .16} ${-h * .59}L${-w * .3} ${-h * .87}Q${-w * .14} ${-h} 0 ${-h}Q${w * .15} ${-h} ${w * .33} ${-h * .86}L${w * .15} ${-h * .61}L${w * .47} ${-h * .78}Q${w} ${-h * .57} ${w * .66} ${-h * .31}L${w * .28} ${-h * .35}L${w * .6} ${-h * .18}Q${w * .24} ${-h * .07} 0 0ZM0 0V${-h * .86}"/><ellipse cx="${-w * .16}" cy="${-h * .57}" rx="2.4" ry="5.2"/><ellipse cx="${w * .18}" cy="${-h * .48}" rx="2.4" ry="4.3"/></g>`).join('');
  }
  if (id === 'chamaedorea' || id === 'nephrolepis') {
    const fern = id === 'nephrolepis';
    return Array.from({ length:fern ? 9 : 7 }, (_, index) => {
      const angle = (index - (fern ? 4 : 3)) * (fern ? 18 : 21), length = fern ? 88 - Math.abs(index - 4) * 5 : 112 - Math.abs(index - 3) * 9;
      const count = fern ? 13 : 8, end = fern ? 28 : 12;
      const foliage = Array.from({ length:count }, (_, j) => {
        const y = -length * (j + .5) / count, size = Math.sin((j + 1) / (count + 1) * Math.PI) * (fern ? 13 : 23);
        return `<path d="M0 ${y}Q${-size * .6} ${y - 5} ${-size} ${y - end}Q${-size * .2} ${y - 8} 0 ${y}Q${size * .6} ${y - 5} ${size} ${y - end}Q${size * .2} ${y - 8} 0 ${y}"/>`;
      }).join('');
      return `<g transform="translate(80 147) rotate(${angle})"><path d="M0 0Q-2 ${-length * .6} 0 ${-length}"/>${foliage}</g>`;
    }).join('');
  }
  if (id === 'hedera') {
    const vines = [[60,141,-25,-49],[68,141,-17,-86],[80,141,3,-100],[90,141,35,-75],[103,142,27,34],[61,142,-25,33]];
    return vines.map(([x,y,dx,dy], index) => `<path d="M${x} ${y}Q${x + dx * .7} ${y + dy * .3} ${x + dx} ${y + dy}"/>` + Array.from({ length:4 }, (_, j) => {
      const f = (j + 1) / 4, lx = x + dx * f, ly = y + dy * f, a = (j % 2 ? 1 : -1) * 35;
      return `<path transform="translate(${lx} ${ly}) rotate(${a + index * 8})" d="M0 0L-10-3L-7-11L-11-16L-3-15L0-25L4-15L12-17L9-8L12-3ZM0 0V-21M0-11L-7-15M0-10L7-15"/>`;
    }).join('')).join('');
  }
  if (id === 'zamioculcas') {
    return [[65,141,-30,90],[77,145,-8,117],[87,144,17,109],[99,143,27,77]].map(([x,y,angle,length]) => `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0Q-3 ${-length * .6} 0 ${-length}"/>${Array.from({ length:5 }, (_, j) => {
      const yy = -length * (j + 1) / 6;
      return leaf(0,yy,10,23,-57) + leaf(0,yy - 4,10,23,57);
    }).join('')}${leaf(0,-length + 10,9,22)}</g>`).join('');
  }
  if (id === 'succulent') {
    return Array.from({ length:3 }, (_, ring) => Array.from({ length:8 }, (_, index) => {
      const angle = index * 45 + ring * 22, length = 42 - ring * 11, width = 17 - ring * 3;
      return `<g transform="translate(80 ${122 - ring * 2}) rotate(${angle})">${leaf(0,0,width,length)}</g>`;
    }).join('')).join('') + '<path d="M73 139L72 149M88 139L88 149"/>';
  }
  if (id === 'cactus') {
    return [[66,147,16,66],[86,147,18,101],[107,148,11,48]].map(([x,y,r,h]) => `<g transform="translate(${x} ${y})"><path d="M${-r} 0V${-h + r}A${r} ${r} 0 0 1 ${r} ${-h + r}V0M${-r * .55} 0Q${-r * .9} ${-h * .5} ${-r * .25} ${-h + 5}M0 0V${-h}M${r * .55} 0Q${r * .9} ${-h * .5} ${r * .25} ${-h + 5}"/>${Array.from({ length:5 }, (_, i) => `<path d="M${-r - 3} ${-12 - i * (h - 16) / 5}l-4-3M${r + 2} ${-16 - i * (h - 16) / 5}l4-3M-2 ${-13 - i * (h - 16) / 5}l4-3"/>`).join('')}</g>`).join('');
  }
  return plantDrawing('monstera');
}

/** Original black-line botanical diagrams, drawn like an assembly booklet. */
export function plantCatalogIllustration(catalogId, potId = 'muskot', { potOnly = false, compact = false } = {}) {
  const viewBox = potOnly ? '42 136 76 62' : '0 0 160 200';
  return `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="white" stroke="currentColor" stroke-width="${compact ? 1.9 : 1.3}" stroke-linecap="round" stroke-linejoin="round">${potOnly ? '' : `<g fill="none">${plantDrawing(catalogId)}</g>`}<g>${potDrawing(potId,{ compact })}</g></svg>`;
}

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
  const brand = element('span','ihr-plant-catalog__brand','IKEA');
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
  previewCaption.append(previewName,previewSubtitle,previewPot);
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
  choices.append(plants,pots);
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
  let trigger = null, destroyed = false, busy = false, opening = false;
  const plantButtons = new Map(), potButtons = new Map();

  function update() {
    const plant = getCatalogPlant(selectedPlant), pot = getCatalogPot(selectedPot);
    drawing.innerHTML = plantCatalogIllustration(selectedPlant,selectedPot);
    previewName.textContent = plant?.name || '';
    previewSubtitle.textContent = plant?.subtitle || '';
    previewPot.textContent = pot?.name || '';
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
    const name = element('span','ihr-plant-catalog__option-name',plant.name);
    button.append(thumbnail,name);
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
    button.append(thumbnail,element('span','ihr-plant-catalog__option-name',pot.name));
    button.addEventListener('click',() => {
      if (busy) return;
      selectedPot = pot.id;
      status.textContent = ''; status.removeAttribute('data-error'); update();
    });
    potList.append(button); potButtons.set(pot.id,button);
  }

  function finishClose() {
    if (!opening) return;
    opening = false;
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
      await onAdd({ catalogId:selectedPlant, potId:selectedPot });
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
  update();
  return {
    open(from = document.activeElement) {
      if (destroyed || opening) return;
      trigger = from instanceof HTMLElement ? from : null;
      opening = true; status.textContent = ''; status.removeAttribute('data-error');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else { dialog.setAttribute('open',''); dialog.setAttribute('aria-modal','true'); }
      body.scrollTop = 0; closeButton.focus({ preventScroll:true });
    },
    close,
    destroy() {
      if (destroyed) return;
      close(); destroyed = true; dialog.remove();
    }
  };
}
