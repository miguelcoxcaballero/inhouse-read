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
// These are host catalogue/Three bindings. Rust owns rows, presentation,
// selection defaults and all flight policy; browser callbacks stay GC-owned.
const catalogueHost = {
  PLANT_CATALOG, POT_CATALOG, SHELF_TYPES, LAMP_CATALOG, LAMP_KELVINS, DEFAULT_LAMP_KELVIN,
  getCatalogPlant, getCatalogPot, getPotColors, getPotColor, getShelfType, getCatalogLamp,
  plantCatalogIllustration, lampCatalogIllustration, kelvinSwatch, plantSizeLabel
};

/** Rust owns selection, pages, presentation, actions and flight state. */
export function createPlantCatalogNative({ onAdd, onAddLamp, onClose, onShelfChange, shelfType = 'walnut', motionTarget, onMotion } = {}, requestedId, catalogUI) {
  const dialog = catalogUI.catalog_dialog(catalogueHost,document,requestedId,ikeaLogo);
  const paper = dialog.querySelector('.ihr-plant-catalog__paper');
  const drawing = dialog.querySelector('.ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights) .ihr-plant-catalog__drawing');
  const shelfDrawing = dialog.querySelector('.ihr-plant-catalog__drawing.ihr-plant-catalog__shelf-drawing');
  const lampDrawing = dialog.querySelector('.ihr-plant-catalog__drawing.ihr-plant-catalog__lamp-drawing');

  const studios = { drawing, shelfDrawing, lampDrawing,
    createPlantCatalogPreview, createShelfCatalogPreview, createLampCatalogPreview };
  const motion = {
    global:globalThis, document, dialog, paper, motionTarget, onMotion,
    bookletRect, catalogCameraFrames, duration:CATALOG_CAMERA_MS,
    easing:CATALOG_CAMERA_EASING, identity:IDENTITY,
    makeFlightCallbacks:state => ({
      land:options => catalogUI.catalog_land_flight(motion,state,options),
      complete:() => catalogUI.catalog_land_flight(motion,state,undefined),
      guard:() => catalogUI.catalog_guard_flight(motion,state)
    }),
    ignore:() => {},
    finishMotion:() => catalogUI.catalog_motion_end(motion),
    paintCallback:work => () => catalogUI.catalog_paint_task(globalThis,work)
  };
  const controller = new catalogUI.RustCatalogController(dialog, {
    describe:(...ids) => catalogUI.catalog_description(catalogueHost,...ids),
    colorId:(potId,remembered) => catalogUI.catalog_color_id(catalogueHost,potId,remembered),
    colorRows:potId => catalogUI.catalog_color_rows(catalogueHost,potId),
    normalizeShelf:normalizeShelfType,
    createPreview:kind => catalogUI.catalog_create_preview(studios,kind),
    frames:from => catalogUI.catalog_motion_frames(motion,from),
    fly:(...args) => catalogUI.catalog_begin_flight(motion,...args),
    afterPaint:work => catalogUI.catalog_after_paint(motion,work),
    onAdd, onAddLamp, onClose, onShelfChange
  },catalogUI.catalog_initial(catalogueHost,shelfType));
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
