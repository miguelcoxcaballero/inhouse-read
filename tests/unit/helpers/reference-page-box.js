// Frozen original of src/js/readers/page-box.js before its logic moved to Rust (tests only).
// The height of a paginated book's page box, kept across openings.
//
// The free height under a book changes by a few dozen pixels with things
// that are not a resize: Android hiding its status bar once the book is open,
// the opening flyout, the audio mini player, the "return" bar. Choosing the
// box from whatever the height was at that moment paginated the same book
// differently each time it was opened. A box is now remembered per page
// width and only ever shrinks, when it no longer fits at all; it converges on the
// smallest of those states and every later opening reuses it. A real resize
// (rotation, split screen, the keyboard) is a different box, kept beside it.

const KEY = 'inhouse-read-page-boxes-v3'
// Legacy budget used by callers to express the same available page height.
// Audio now lives in the header; Foliate adds this back before calling us.
export const MINI_PLAYER_RESERVE = 52
// A change of free height beyond this is a real resize, not chrome.
export const PAGE_BOX_SLACK = 96
const MAX_BOXES = 8

function load(storage) {
  try {
    const boxes = JSON.parse(storage?.getItem(KEY) || '[]')
    return Array.isArray(boxes) ? boxes.filter(box => [box?.width, box?.target, box?.height].every(Number.isFinite)) : []
  } catch { return [] }
}

function save(storage, boxes) {
  try { storage?.setItem(KEY, JSON.stringify(boxes.slice(-MAX_BOXES))) } catch { /* Private mode keeps it for this session only. */ }
}

/**
 * width: the page width. space: the height the book could use with no
 * overlays shown (the mini player and the return bar added back). free: the
 * height actually free now. Returns the box height to apply.
 */
export function stablePageHeight({ width, space, free, storage = globalThis.localStorage, boxes = load(storage) }) {
  width = Math.round(width)
  const target = Math.max(240, Math.floor(space - MINI_PLAYER_RESERVE))
  let box = boxes.find(item => Math.abs(item.width - width) <= 1 && Math.abs(item.target - target) <= PAGE_BOX_SLACK)
  if (!box) {
    box = { width, target, height:target }
    boxes.push(box)
    save(storage, boxes)
  } else if (box.height > target + 0.5) {
    box.height = target
    save(storage, boxes)
  }
  // Audio and return controls occupy the existing header; their visibility
  // cannot resize the page. Only a smaller viewport can reduce this bound.
  return Math.max(1, Math.min(box.height, Math.floor(free)))
}
