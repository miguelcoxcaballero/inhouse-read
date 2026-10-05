// Camera flight between the catalogue booklet standing in the room and the
// catalogue page. Pure geometry: the room is scaled and moved so the booklet's
// cover grows to fill the page, while the page unfolds from the cover.

export const CATALOG_CAMERA_MS = 480;
export const CATALOG_CAMERA_EASING = 'cubic-bezier(.65, 0, .35, 1)';
export const IDENTITY = 'translate(0px, 0px) scale(1, 1)';

const finite = value => Number.isFinite(value);
const px = value => `${Math.round(value * 100) / 100}px`;

/** The printed cover, in viewport pixels. The scene writes its offset inside
 * the booklet's button as `data-booklet-face="x y width height"`; without it
 * the whole button counts. */
export function bookletRect(node) {
  const box = node.getBoundingClientRect();
  const face = (node.dataset?.bookletFace || '').split(' ').map(Number);
  if (face.length === 4 && face.every(finite) && face[2] > 0 && face[3] > 0) {
    const [x, y, width, height] = face;
    return { left:box.left + x, top:box.top + y, width, height, right:box.left + x + width, bottom:box.top + y + height };
  }
  return { left:box.left, top:box.top, width:box.width, height:box.height, right:box.right, bottom:box.bottom };
}

/**
 * Transforms (origin 0 0) for one flight: `stage` takes the room from where it
 * is to where the booklet's cover covers the page; `page` takes the page from
 * the cover's rectangle to its own place. Null when a rectangle is empty.
 */
export function catalogCameraFrames(booklet, page, stage) {
  const sizes = [booklet.width, booklet.height, page.width, page.height, stage.width, stage.height];
  if (!sizes.every(value => finite(value) && value > 0)) return null;
  const scale = Math.max(page.width / booklet.width, page.height / booklet.height);
  const x = page.left + page.width / 2 - stage.left - scale * (booklet.left + booklet.width / 2 - stage.left);
  const y = page.top + page.height / 2 - stage.top - scale * (booklet.top + booklet.height / 2 - stage.top);
  return {
    stage:`translate(${px(x)}, ${px(y)}) scale(${Math.round(scale * 10000) / 10000}, ${Math.round(scale * 10000) / 10000})`,
    page:`translate(${px(booklet.left - page.left)}, ${px(booklet.top - page.top)}) scale(${Math.round(booklet.width / page.width * 10000) / 10000}, ${Math.round(booklet.height / page.height * 10000) / 10000})`
  };
}
