// Frozen original of the numbers and decisions the bookshelf scene computed in JavaScript before they moved to
// Rust (rust-ui/src/scene_*.rs). Each function is the original closure code of src/js/bookshelf-scene.js, copied
// statement for statement, with the closure's variables turned into parameters. Do not update to match the Rust
// implementation; the whole scene is replayed against reference-bookshelf-scene.js by scene-differential.test.js.
import * as THREE from 'three'

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
export const ease = t => t * t * t * (t * (t * 6 - 15) + 10)
export const smoothTrash = t => t * t * (3 - 2 * t)
const TRASH_PADDING = 7
const vector = new THREE.Vector3()

export const corners = (box, transform, out = {}) => {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, closest = -Infinity
  const { min, max } = box
  for (let corner = 0; corner < 8; corner++) {
    vector.set(corner & 4 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 1 ? max.z : min.z).applyMatrix4(transform)
    left = Math.min(left, vector.x); right = Math.max(right, vector.x)
    top = Math.min(top, -vector.y); bottom = Math.max(bottom, -vector.y); closest = Math.max(closest, vector.z)
  }
  out.left = left; out.right = right; out.top = top; out.bottom = bottom
  out.width = right - left; out.height = bottom - top; out.closest = closest
  return out
}

export function disjointRectangles(rectangles, outer) {
  const clipped = rectangles.map(rect => ({ left:Math.max(rect.left, outer.left), right:Math.min(rect.right, outer.right),
    top:Math.max(rect.top, outer.top), bottom:Math.min(rect.bottom, outer.bottom) }))
    .filter(rect => rect.right > rect.left && rect.bottom > rect.top)
  const edges = [...new Set(clipped.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b), strips = []
  for (let i = 0; i < edges.length - 1; i++) {
    const left = edges[i], right = edges[i + 1], intervals = clipped.filter(rect => rect.left < right && rect.right > left)
      .sort((a, b) => a.top - b.top)
    let merged = null
    for (const interval of intervals) {
      if (merged && interval.top <= merged.bottom) merged.bottom = Math.max(merged.bottom, interval.bottom)
      else { merged = { left, right, top:interval.top, bottom:interval.bottom }; strips.push(merged) }
    }
  }
  return strips
}

/** updateDropMarker, with the row and the guide passed in. */
export function dropMarker(row, dropPosition, width, depth) {
  const undershelf = dropPosition.mount === 'undershelf'
  const ceiling = row.ceiling ?? row.top
  const markerHeight = undershelf ? clamp((row.bottom - ceiling) * .08, 12, 24) : clamp((row.bottom - row.top) * .82, 60, 180)
  const { left = 0, right = width, padding = 16 } = row
  return [-width / 2 + left + padding + dropPosition.x * (right - left - padding * 2),
    -(undershelf ? ceiling : row.bottom), undershelf ? -depth / 2 : 13,
    (undershelf ? -1 : 1) * markerHeight / 2, markerHeight, undershelf ? -1 : 1]
}

/** measureFitHeight, with the layout rectangles and the computed style passed in. */
export function measureFitHeight({ innerHeight, clip, stageBounds, scrollTop, paddingBottom, edgeToEdge }) {
  const bottomPadding = parseFloat(paddingBottom) || 0
  const restingTop = stageBounds.top + scrollTop
  return Math.max(1, Math.floor(Math.min(innerHeight, clip.bottom) - Math.max(clip.top, restingTop) - bottomPadding) - (edgeToEdge ? 0 : 2))
}

/** The numeric part of updateTransform. `state` holds the closure's variables; it is updated like the closure's. */
export function updateTransform(state, { trash = null, rooftop = [], floorVisible = false, unitCount = 1 }) {
  const { width, sceneWidth, fullBounds } = state
  const furniture = new THREE.Group()
  const transformRects = { unscaled:{}, framed:{}, bounds:{}, world:{} }
  const framedScratch = new THREE.Box3(), framedTrash = new THREE.Box3()
  const { progress } = state
  const yaw = -Math.PI / 6 * progress, pitch = 14 * Math.PI / 180 * progress
  furniture.position.set(0, 0, 0); furniture.rotation.set(pitch, yaw, 0); furniture.scale.setScalar(1)
  furniture.updateMatrix()
  const unscaled = corners(fullBounds, furniture.matrix, transformRects.unscaled)
  const sceneFitHeight = state.sceneFitHeight, edgeToEdge = state.edgeToEdge
  const padding = (edgeToEdge ? 0 : 8) * progress
  const framedBounds = framedScratch.copy(fullBounds)
  for (const entry of rooftop) if (entry.rooftop) framedBounds.max.y = Math.max(framedBounds.max.y, -entry.y + entry.height / 2)
  if (trash) framedBounds.union(framedTrash.copy(trash.bounds).translate(trash.position))
  const framed = corners(framedBounds, furniture.matrix, transformRects.framed)
  const frameLeft = unscaled.left + (framed.left - unscaled.left) * progress
  const frameRight = unscaled.right + (framed.right - unscaled.right) * progress
  const widthZoom = Math.min((1 - .22 * progress) * Math.min(1, width / unscaled.width),
    (sceneWidth - padding * 2 - TRASH_PADDING * 2 * progress) / (frameRight - frameLeft))
  const heightZoom = Math.min(1, (sceneFitHeight - padding * 2) / Math.max(1, framed.height))
  const fitZoom = Math.max(.0001, Math.min(widthZoom, 1 + (heightZoom - 1) * progress))
  furniture.scale.setScalar(fitZoom); furniture.updateMatrix()
  const bounds = corners(framedBounds, furniture.matrix, transformRects.bounds)
  const factor = 1 + (state.inspectionZoom - 1) * progress, zoom = fitZoom * factor
  state.panX = clamp(state.panX, -(state.inspectionZoom - 1) * sceneWidth / 2 - (state.inspectionMoving ? 80 : 0), (state.inspectionZoom - 1) * sceneWidth / 2 + (state.inspectionMoving ? 80 : 0))
  state.panY = clamp(state.panY, -(state.inspectionZoom - 1) * sceneFitHeight / 2 - (state.inspectionMoving ? 80 : 0), (state.inspectionZoom - 1) * sceneFitHeight / 2 + (state.inspectionMoving ? 80 : 0))
  const reserve = (frameRight - frameLeft - unscaled.width) * fitZoom
  const baseX = sceneWidth / 2 - (frameLeft + frameRight) * fitZoom / 2, baseY = bounds.top - padding
  furniture.scale.setScalar(zoom)
  furniture.position.set(baseX * factor + (1 - factor) * sceneWidth / 2 + state.panX * progress,
    baseY * factor - (1 - factor) * sceneFitHeight / 2 - state.panY * progress, 0)
  const scene = new THREE.Scene(); scene.add(furniture)
  furniture.updateWorldMatrix(false, false)
  const objectHeight = Math.ceil(bounds.height + padding * 2 - 1e-7)
  const stageHeight = edgeToEdge ? objectHeight + Math.max(0, sceneFitHeight - objectHeight) * progress : objectHeight
  const framedWorld = corners(framedBounds, furniture.matrixWorld, transformRects.world)
  return {
    yaw, pitch, zoom, x:furniture.position.x, y:furniture.position.y, reserve, stageHeight,
    inFrame:framedWorld.left >= -.01 && framedWorld.right <= sceneWidth + .01 && framedWorld.top >= -.01 && framedWorld.bottom <= sceneFitHeight + .01,
    texts:[state.desiredMode, String(Number(progress.toFixed(4))), (-30 * progress).toFixed(3), (14 * progress).toFixed(3), zoom.toFixed(4),
      state.inspectionZoom.toFixed(4), String(state.inspectionMoving), JSON.stringify([state.panX, state.panY]), String(width),
      reserve.toFixed(3), String(unitCount), String(sceneFitHeight), String(floorVisible), String(
        framedWorld.left >= -.01 && framedWorld.right <= sceneWidth + .01 && framedWorld.top >= -.01 && framedWorld.bottom <= sceneFitHeight + .01)]
  }
}

/** viewport()'s sizes, with the window and layout numbers passed in. */
export function viewportSizes(state, { clientHeight, innerHeight, devicePixelRatio }) {
  const { width, progress, edgeToEdge, sceneFitHeight, inspectionZoom, desiredMode } = state
  const availableHeight = edgeToEdge && progress === 1 ? sceneFitHeight : clientHeight || innerHeight
  const viewportHeight = Math.max(1, Math.ceil(Math.min(availableHeight, innerHeight)))
  const ratio = Math.min(devicePixelRatio || 1, inspectionZoom > 1.001 && desiredMode === 'isometric' ? 2.5 : width < 600 ? 1.5 : 2)
  const baseRatio = Math.min(devicePixelRatio || 1, width < 600 ? 1.5 : 2)
  const shelfHeight = Math.ceil(Math.min(clientHeight || innerHeight, innerHeight))
  return { viewportHeight, ratio, baseRatio, shelfHeight }
}

/** The turn's frame: the closure's `transition` object is updated in place. */
export function stepTransition(transition, now, DURATION = 700) {
  transition.elapsed += Math.min(50, Math.max(0, now - transition.lastFrame))
  transition.lastFrame = now
  const t = clamp(transition.elapsed / DURATION, 0, 1)
  const progress = transition.from + (transition.to - transition.from) * ease(t)
  const scrollPan = transition.scrollFrom + (transition.scrollTo - transition.scrollFrom) * ease(t)
  return { progress, scrollPan, done:t === 1 }
}

export const reorderAmount = (started, now) => { const t = clamp((now - started) / 520, 0, 1); return { amount:1 - ease(t), done:t === 1 } }

/** setInspectionView's arithmetic. */
export function setInspectionView(state, view, moving) {
  const previousInspection = [state.inspectionZoom, state.panX, state.panY]
  state.inspectionZoom = clamp(Number(view.zoom) || 1, 1, 4); state.inspectionMoving = Boolean(moving)
  const slack = state.inspectionMoving ? 80 : 0
  state.panX = clamp(Number(view.panX) || 0, -(state.inspectionZoom - 1) * state.sceneWidth / 2 - slack, (state.inspectionZoom - 1) * state.sceneWidth / 2 + slack)
  state.panY = clamp(Number(view.panY) || 0, -(state.inspectionZoom - 1) * state.sceneFitHeight / 2 - slack, (state.inspectionZoom - 1) * state.sceneFitHeight / 2 + slack)
  return previousInspection.some((value, index) => value !== [state.inspectionZoom, state.panX, state.panY][index])
}

export function zoomTo(state, value, clientX, clientY, rect) {
  const next = clamp(Number(value) || 1, 1, 4), relative = next / state.inspectionZoom
  const x = Number.isFinite(clientX) ? clientX - rect.left : state.sceneWidth / 2
  const y = Number.isFinite(clientY) ? clientY - rect.top : state.sceneFitHeight / 2
  state.panX = x - state.sceneWidth / 2 - (x - state.sceneWidth / 2 - state.panX) * relative
  state.panY = y - state.sceneFitHeight / 2 - (y - state.sceneFitHeight / 2 - state.panY) * relative
  state.inspectionZoom = next
  if (next === 1) state.panX = state.panY = 0
  return state.inspectionZoom
}

export function panBy(state, x, y) {
  if (state.desiredMode !== 'isometric' || state.inspectionZoom <= 1) return false
  state.panX += Number(x) || 0; state.panY += Number(y) || 0
  return true
}

/** paintInspectionSnapshot's project(). */
export function project(state, source, viewportHeight) {
  const scale = state.inspectionZoom / source.zoom
  const dx = state.sceneWidth / 2 + state.panX - scale * (state.sceneWidth / 2 + source.panX)
  const dy = state.sceneFitHeight / 2 + state.panY - scale * (state.sceneFitHeight / 2 + source.panY)
  const left = dx - source.margin * scale, top = dy - source.margin * scale
  return { scale, left, top, covers:left <= 0 && top <= 0 && left + source.width * scale >= state.sceneWidth &&
    top + source.height * scale >= viewportHeight }
}

/** setDropPosition's validation. */
export function dropPositionOf(position, rows) {
  const shelf = Number(position?.shelf), x = Number(position?.x)
  return position && Number.isInteger(shelf) && rows[shelf] && Number.isFinite(x)
    ? { shelf, x:clamp(x, 0, 1), ...(position.mount === 'undershelf' ? { mount:'undershelf' } : {}) } : null
}

/** updateCatalog's tap box and face, with the catalogue's matrix and box, and the layout, passed in. */
export function catalogFrame({ bounds, matrixWorld, cover, scroll, viewportHeight, progress, desiredMode, stageBounds, clip, innerWidth, innerHeight }) {
  const box = corners(bounds, matrixWorld, {})
  const viewHidden = desiredMode !== 'isometric' || progress < .86
  const screenTop = stageBounds.top + box.top, screenBottom = stageBounds.top + box.bottom
  const screenLeft = stageBounds.left + box.left, screenRight = stageBounds.left + box.right
  const visible = !viewHidden && box.bottom > scroll && box.top < scroll + viewportHeight &&
    screenBottom > Math.max(0, clip.top) && screenTop < Math.min(innerHeight, clip.bottom) &&
    screenRight > Math.max(0, clip.left) && screenLeft < Math.min(innerWidth, clip.right)
  const targetWidth = Math.max(44, box.width), targetHeight = Math.max(44, box.height)
  const left = box.left - (targetWidth - box.width) / 2, top = box.top - (targetHeight - box.height) / 2
  const { width:coverWidth = 76, height:coverHeight = 108, thickness = 3.4 } = cover
  const catalogFace = new THREE.Box3()
  catalogFace.min.set(-coverWidth / 2, -coverHeight / 2, thickness / 2)
  catalogFace.max.set(coverWidth / 2, coverHeight / 2, thickness / 2)
  const face = corners(catalogFace, matrixWorld, {}), half = value => Math.round(value * 2) / 2
  return { visible, viewHidden, targetWidth, targetHeight, left, top,
    face:[face.left - left, face.top - top, face.width, face.height].map(half).join(' ') }
}

/** updateCatalog's placement. */
export function catalogPlace(first, width, depth, progress) {
  const center = first.top + Math.max(68, Math.min(120, (first.bottom - first.top) * .5))
  return [width / 2 + 3, -center, -depth * .52, progress > .36]
}

/** updateTrash's lid, flight and tap box. */
export function trashDropStep(drop, now) {
  if (!drop.complete) {
    drop.elapsed += Math.min(50, Math.max(0, now - drop.lastFrame))
    drop.lastFrame = now
  }
  const t = drop.duration > 0 ? clamp(drop.elapsed / drop.duration, 0, 1) : 1
  const close = smoothTrash(clamp((t - .78) / .22, 0, 1))
  const openness = (drop.initialOpenness + (1 - drop.initialOpenness) * ease(clamp(t / .2, 0, 1))) * (1 - close)
  return { t, openness, bounce:clamp((t - .84) / .16, 0, 1) }
}
export function trashEndScale(worldScale, radius, width, height) {
  const tiltedWidth = width * Math.cos(.46) + height * Math.sin(.46)
  return Math.min(.19 * worldScale, radius * 1.45 * worldScale / Math.max(1, tiltedWidth))
}
export function trashOverflow(right, sceneWidth, t) {
  const rightOverflow = Math.max(0, right - sceneWidth + 3)
  return rightOverflow ? rightOverflow * ease(clamp(t / .14, 0, 1)) : null
}
export function trashFrame({ trashRect, scroll, viewportHeight, sceneWidth, sceneFitHeight, viewHidden, stageBounds, scrollerBounds, innerWidth, innerHeight, visualBottom }) {
  const visibleBottom = Math.min(scrollerBounds.bottom, innerHeight || Infinity,
    Number.isFinite(visualBottom) && visualBottom > 0 ? visualBottom : Infinity)
  const screenTop = stageBounds.top + trashRect.top, screenBottom = stageBounds.top + trashRect.bottom
  const screenLeft = stageBounds.left + trashRect.left, screenRight = stageBounds.left + trashRect.right
  const inFrame = trashRect.right > 0 && trashRect.left < sceneWidth &&
    trashRect.bottom > scroll && trashRect.top < scroll + viewportHeight
  const visible = !viewHidden && inFrame &&
    screenBottom > Math.max(0, scrollerBounds.top) && screenTop < visibleBottom &&
    screenRight > Math.max(0, scrollerBounds.left) && screenLeft < Math.min(innerWidth, scrollerBounds.right)
  const hitWidth = Math.max(44, trashRect.width + TRASH_PADDING * 2), hitHeight = Math.max(44, trashRect.height + TRASH_PADDING * 2)
  const hitLeft = clamp((trashRect.left + trashRect.right - hitWidth) / 2, 0, Math.max(0, sceneWidth - hitWidth))
  const hitTop = clamp((trashRect.top + trashRect.bottom - hitHeight) / 2, scroll,
    Math.max(scroll, Math.min(scroll + viewportHeight, sceneFitHeight) - hitHeight))
  return { visible, inFrame, hitLeft, hitTop, hitWidth, hitHeight }
}
export function trashTexts({ position, scale, rotation, footY, floorY, footWorld, floorContact, radius, height }) {
  return [`${position.x.toFixed(6)},${position.y.toFixed(6)},${position.z.toFixed(6)}`, scale.toFixed(6), `${rotation.x},${rotation.y},${rotation.z}`,
    footY.toFixed(6), floorY.toFixed(6), `${footWorld.x.toFixed(6)},${footWorld.y.toFixed(6)},${footWorld.z.toFixed(6)}`,
    `${floorContact.x.toFixed(6)},${floorContact.y.toFixed(6)},${floorContact.z.toFixed(6)}`, String(radius), String(height)]
}
export function trashTransitionStep(transition, now, reduced) {
  const t = reduced ? 1 : clamp((now - transition.started) / 170, 0, 1)
  return { openness:transition.from + (transition.to - transition.from) * ease(t), done:t === 1, moving:t < 1 }
}

/** The insertion overlay's frame. */
export function insertionFrame(box, camera, vw, vh) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  const insertionPoint = new THREE.Vector3()
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        insertionPoint.set(x, y, z).project(camera)
        const px = (insertionPoint.x + 1) * vw / 2, py = (1 - insertionPoint.y) * vh / 2
        left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py)
      }
  const width = Math.min(vw, 256), height = Math.min(vh, 384)
  left = Math.max(0, left); top = Math.max(0, top); right = Math.min(vw, right); bottom = Math.min(vh, bottom)
  if ([left, top, right, bottom].every(Number.isFinite) && right >= left && bottom >= top
    && (width === vw || right - left + 48 <= width) && (height === vh || bottom - top + 48 <= height)) {
    return { found:true, x:width === vw ? 0 : Math.round((left + right - width) / 2),
      y:height === vh ? 0 : Math.round((top + bottom - height) / 2), width, height }
  }
  return { found:false, x:0, y:0, width:vw, height:vh }
}

// ---- the entries

export function advancePreview(preview, now, reduced) {
  if (!preview.active) return false
  const t = reduced ? 1 : clamp((now - preview.started) / 130, 0, 1)
  const x = preview.fromX + (preview.targetX - preview.fromX) * ease(t)
  const y = preview.fromY + (preview.targetY - preview.fromY) * ease(t)
  const changed = x !== preview.x || y !== preview.y
  preview.x = x; preview.y = y
  if (t === 1) preview.active = false
  return changed
}
export function previewOffset(preview, x, y, now, reduced) {
  const changed = advancePreview(preview, now, reduced)
  if (Math.abs(x - preview.targetX) + Math.abs(y - preview.targetY) < .01) return changed
  Object.assign(preview, { fromX:preview.x, fromY:preview.y, targetX:x, targetY:y, started:now, active:true })
  return true
}
export const previewTarget = (row, center, entry) => ({
  x:(row.left || 0) + center - entry.x,
  y:entry.y - (entry.kind === 'lamp' && entry.mount === 'undershelf' ? row.ceiling ?? row.top : row.bottom - entry.height / 2)
})

const plantHalfDepth = entry => (entry.depth || entry.width * .7) / 2
export const slotBox = entry => {
  if (entry.kind === 'lamp') return new THREE.Box3(
    new THREE.Vector3(-entry.width / 2, entry.mount === 'undershelf' ? -entry.height : 0, -(entry.depth || entry.width) / 2),
    new THREE.Vector3(entry.width / 2, entry.mount === 'undershelf' ? 0 : entry.height, (entry.depth || entry.width) / 2)
  )
  const plant = entry.kind === 'plant'
  return new THREE.Box3(
    new THREE.Vector3(-entry.width / 2 - (plant ? 0 : entry.thickness * .38), -entry.height / 2, -(plant ? plantHalfDepth(entry) : entry.thickness / 2)),
    new THREE.Vector3(entry.width / 2, entry.height / 2 + (plant ? 0 : 20), plant ? plantHalfDepth(entry) : entry.thickness / 2)
  )
}
export const fallbackBoxOf = (entry, plant) => plant ? new THREE.Box3(
  new THREE.Vector3(-entry.width * .285, -entry.height / 2, -entry.width * .285),
  new THREE.Vector3(entry.width * .285, -entry.height / 2 + entry.height * .32, entry.width * .285)
) : new THREE.Box3(
  new THREE.Vector3(-entry.width / 2 - entry.thickness * .38, -entry.height / 2, -entry.thickness / 2),
  new THREE.Vector3(-entry.width / 2, entry.height / 2, entry.thickness / 2))

const CLASS_SEPARATOR = /[ \t\n\f\r]+/
export function classFlags(classes) {
  const tokens = classes.split(CLASS_SEPARATOR)
  return { away:tokens.includes('is-away'), dragging:tokens.includes('is-dragging'),
    lifted:tokens.includes('is-lifted'), pressed:tokens.includes('is-pressed') && !tokens.includes('is-press-pending') }
}
export const stateText = (flags, dragX, dragY, disabled, pointerEvents) => {
  const { away, dragging, lifted, pressed } = flags
  return [away, dragging, lifted, pressed, dragX, dragY, disabled, pointerEvents].join('|')
}
export function pressureOnly(a, b) {
  const previous = a.split('|'), current = b.split('|')
  return previous.length === current.length && previous.every((value, index) => index === 3 || value === current[index])
}

export function advanceLampPower(power, isOn, now, reduced) {
  const target = isOn === false ? 0 : 1
  if (power.target !== target) Object.assign(power, { from:power.value, target, started:now, duration:220 })
  const previous = power.value
  const t = reduced || !power.duration ? 1 : clamp((now - power.started) / power.duration, 0, 1)
  power.value = power.from + (power.target - power.from) * ease(t)
  return { moving:t < 1 && power.from !== power.target, changed:previous !== power.value }
}

export function insertionStep(insertion, now) {
  insertion.elapsed += Math.min(50, Math.max(0, now - insertion.lastFrame))
  insertion.lastFrame = now
  const t = insertion.duration > 0 ? clamp(insertion.elapsed / insertion.duration, 0, 1) : 1
  return { t, eased:ease(t) }
}

/** The lift, landing and pose of one entry (updateEntries), with the DOM-derived inputs passed in. */
export function stepEntry(entry, { flags, dragX, dragY, now, reduced, zoom, inverseRotation, width, depth }) {
  const dragging = flags.dragging, lifted = dragging || flags.lifted
  const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', decorative = plant || lamp, undershelf = lamp && entry.mount === 'undershelf'
  const previewChanged = advancePreview(entry.preview, now, reduced)
  const targetLift = lifted ? 1 : flags.pressed ? .22 : 0
  const previousLift = entry.lift.value
  let changingLift
  if (entry.landing && targetLift === 0) {
    const t = reduced ? 1 : clamp((now - entry.landing.started) / entry.landing.duration, 0, 1)
    entry.lift.value = entry.landing.from * (1 - ease(clamp((t - .7) / .3, 0, 1)))
    Object.assign(entry.lift, { from:entry.lift.value, target:0, started:now })
    changingLift = t < 1 && entry.landing.from > 0
    if (t === 1) entry.landing = null
  } else {
    entry.landing = null
    if (entry.lift.target !== targetLift) {
      entry.lift.from = entry.lift.value; entry.lift.target = targetLift; entry.lift.started = now
    }
    const liftTime = reduced ? 1 : clamp((now - entry.lift.started) / 160, 0, 1)
    entry.lift.value = entry.lift.from + (entry.lift.target - entry.lift.from) * ease(liftTime)
    changingLift = liftTime < 1 && entry.lift.from !== entry.lift.target
  }
  const lift = entry.lift.value
  const screenX = (dragging ? parseFloat(dragX) || 0 : 0) + entry.offset.x
  const screenY = (dragging ? parseFloat(dragY) || 0 : 0) + entry.offset.y - 18 * lift
  vector.set(screenX / zoom, -screenY / zoom, 30 * lift / zoom).applyQuaternion(inverseRotation)
  const pose = new THREE.Object3D()
  pose.position.set(entry.x - width / 2 + vector.x + entry.preview.x,
    -entry.y - (lamp && !undershelf ? entry.height / 2 : 0) + vector.y + entry.preview.y,
    (undershelf ? -depth / 2
      : lamp ? -(entry.depth || entry.width) / 2 : plant ? -plantHalfDepth(entry) : -entry.width / 2)
      - (undershelf ? 0 : entry.depthInset || 0) + vector.z)
  pose.rotation.set(decorative ? 4 * Math.PI / 180 * lift : 0,
    decorative ? -7 * Math.PI / 180 * lift : Math.PI / 2 - 7 * Math.PI / 180 * lift,
    decorative ? -3 * Math.PI / 180 * lift : 0)
  pose.scale.setScalar(1 + .04 * lift)
  pose.updateMatrix()
  return { pose, previewChanged, changingLift, liftChanged:previousLift !== entry.lift.value }
}

/** The projection decisions of one entry (visible, quality, model visibility). */
export function projectDecisions(entry, { rect, flags, scroll, viewportHeight, inspectionMoving, inspectionZoom, progress, transition, desiredMode, devicePixelRatio, insertion, trashDrop }) {
  const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', decorative = plant || lamp
  const dragging = flags.dragging, lifted = dragging || flags.lifted, away = flags.away
  const visible = Boolean(trashDrop) || ((!away || insertion) && rect.bottom > scroll - 220 && rect.top < scroll + viewportHeight + 220)
  const result = { visible, applies:false, overview:entry.overview, inspectionResolution:entry.inspectionResolution,
    modelVisible:trashDrop ? !trashDrop.complete : !away || Boolean(insertion && !insertion.overlayCanvas) }
  if (plant && visible && !trashDrop && !insertion && !away && !inspectionMoving) {
    result.applies = true
    result.inspectionResolution = inspectionZoom > 1.001 && progress === 1 ? 256 : 0
  }
  if (!decorative && visible && !trashDrop && !insertion && !away && !inspectionMoving) {
    result.applies = true
    const stableView = !transition && (progress === 0 || progress === 1)
    if (lifted || flags.pressed) result.overview = false
    else if (!entry.model && desiredMode === 'isometric' && rect.height < 90) result.overview = true
    else if (stableView) result.overview = progress === 1 && rect.height < 90
    const physicalHeight = rect.height * Math.min(devicePixelRatio || 1, 2.5)
    const inspecting = inspectionZoom > 1.001 && progress === 1 && physicalHeight > 192
    if (inspecting) result.overview = false
    result.inspectionResolution = inspecting ? (physicalHeight > 900 ? 2048 : 1024) : 0
  }
  return result
}

export const padTapRect = (rect, minWidth, out = {}) => {
  const extra = Math.max(0, minWidth - rect.width)
  out.left = rect.left - extra / 2; out.top = rect.top
  out.width = rect.width + extra; out.height = rect.height
  return out
}
export const padTapSquare = (rect, minSize, out = {}) => {
  const extraX = Math.max(0, minSize - rect.width), extraY = Math.max(0, minSize - rect.height)
  out.left = rect.left - extraX / 2; out.top = rect.top - extraY / 2
  out.width = rect.width + extraX; out.height = rect.height + extraY
  return out
}
export function nearestTapTarget(targets, x, y) {
  let best = null, bestDistance = Infinity
  for (const target of targets) {
    if (x < target.left || x > target.left + target.width || y < target.top || y > target.top + target.height) continue
    const distance = (x - target.left - target.width / 2) ** 2 + ((y - target.top - target.height / 2) * .25) ** 2
    if (distance < bestDistance) { bestDistance = distance; best = target }
  }
  return best
}

export function recordDimensions(entry, style, { dimensions = null, row, scale, usableDepth }) {
  const baseline = entry.y + entry.height / 2
  const previousRatio = entry.width / entry.height
  const baseHeight = entry.height / (Number(entry.style.heightRatio) || 1)
  entry.height = baseHeight * (Number(style.heightRatio) || Number(entry.style.heightRatio) || 1)
  const ratio = Number(style.coverRatio)
  entry.width = entry.height * (ratio > 0 && Number.isFinite(ratio) ? clamp(ratio, .25, 2.5) : previousRatio)
  entry.thickness = Number(style.width) || entry.thickness
  entry.y = baseline - entry.height / 2
  if (dimensions) for (const field of ['width', 'height', 'thickness', 'x', 'y', 'depthInset', 'shelf']) if (dimensions[field] !== undefined) entry[field] = dimensions[field]
  if (!dimensions) {
    const fit = Math.min(1, usableDepth * scale / entry.width,
      row ? (row.bottom - row.top - 4 * scale) / entry.height : 1)
    entry.height *= fit; entry.width *= fit; entry.y = baseline - entry.height / 2
  }
  return entry
}

function remember(list, index, value) { if (list[index] === value) return 0; list[index] = value; return 1 }
/** updatePlantFoliage's clip: the closure's memo array is updated like the original's. */
export function foliageClip(inputs, reference, rect, exclusionRects) {
  const length = 10 + exclusionRects.length * 4
  let changed = inputs.length !== length ? 1 : 0, slot = 10
  inputs.length = length
  changed |= remember(inputs, 0, reference.left) | remember(inputs, 1, reference.right) | remember(inputs, 2, reference.top) |
    remember(inputs, 3, reference.bottom) | remember(inputs, 4, reference.width) | remember(inputs, 5, reference.height) |
    remember(inputs, 6, rect.left) | remember(inputs, 7, rect.top) | remember(inputs, 8, rect.width) | remember(inputs, 9, rect.height)
  for (const area of exclusionRects) {
    changed |= remember(inputs, slot++, area.left) | remember(inputs, slot++, area.right) |
      remember(inputs, slot++, area.top) | remember(inputs, slot++, area.bottom)
  }
  if (!changed) return null
  const stableCoordinate = value => Math.round(value * 1000) / 1000
  const toReference = bounds => ({
    left:stableCoordinate(reference.left + (bounds.left - rect.left) * reference.width / rect.width),
    right:stableCoordinate(reference.left + (bounds.right - rect.left) * reference.width / rect.width),
    top:stableCoordinate(reference.top + (bounds.top - rect.top) * reference.height / rect.height),
    bottom:stableCoordinate(reference.top + (bounds.bottom - rect.top) * reference.height / rect.height)
  })
  const rectanglePath = bounds => `M${bounds.left},${bounds.top}H${bounds.right}V${bounds.bottom}H${bounds.left}Z`
  return rectanglePath(reference) + disjointRectangles(exclusionRects.map(toReference), reference).map(rectanglePath).join('')
}

// ---- draw

export const casterHash = (trashVisible, ids) => {
  let casters = trashVisible ? 1 : 0
  for (const id of ids) casters = Math.imul(casters, 31) + id | 0
  return casters
}
export const daylight = (lampPower, baggebo) => 1 - lampPower * (baggebo ? .18 : .3)

export function shadowBounds(fullBounds, trash, matrixWorld) {
  const bounds = new THREE.Box3().copy(fullBounds)
  if (trash) bounds.union(new THREE.Box3().copy(trash.bounds).translate(trash.position))
  bounds.applyMatrix4(matrixWorld)
  return bounds
}

export function capturePlan({ cacheInspection, viewportHeight, sceneWidth, ratio, canvas }) {
  const margin = cacheInspection ? Math.floor(Math.min(128, viewportHeight / 4) / 4) * 4 : 0
  const renderWidth = sceneWidth + margin * 2, renderHeight = viewportHeight + margin * 2
  const pixelAligned = canvas && [canvas.left, canvas.top].every(value => Number.isInteger(value * ratio)) &&
    (!margin || [sceneWidth, viewportHeight, margin].every(value => Number.isInteger(value * ratio)))
  return { margin, renderWidth, renderHeight, pixelAligned:Boolean(pixelAligned),
    whole:[renderWidth * ratio, renderHeight * ratio].every(Number.isInteger),
    finite:Boolean(canvas && [canvas.left, canvas.top].every(Number.isFinite)) }
}

export function counts(entries) {
  const resolutions = []
  let plants = 0, highPlants = 0, lamps = 0, overview = 0, detailed = 0, highBooks = 0, pending = 0, bookCount = 0
  for (const entry of entries) {
    if (entry.qualityReplacement || entry.plantQuality) pending++
    const model = entry.model
    if (!model?.visible) continue
    if (entry.kind === 'plant') { plants++; if (model.userData.inspectionResolution) highPlants++ }
    else if (entry.kind === 'lamp') lamps++
    else {
      if (model.userData.overview) overview++; else detailed++
      if (model.userData.inspectionResolution) highBooks++
      const resolution = model.userData.inspectionResolution || 0
      resolutions[bookCount] = resolution
      bookCount++
    }
  }
  return { counts:[plants, highPlants, lamps, overview, detailed, highBooks, pending, bookCount], text:JSON.stringify(resolutions) }
}

export const cacheMiss = ({ noContext, noSnapshot, contentDirty, shadowDirty, sceneMoving, settling, shadowRefit, transition, drop }) =>
  noContext ? 'no-context' : noSnapshot ? 'no-snapshot' : contentDirty ? 'content-dirty' : shadowDirty ? 'shadow-dirty' :
    sceneMoving ? 'scene-moving' : settling && !shadowRefit ? 'shadow-settling' : transition ? 'transition' : drop ? 'drop-guide' : ''

// ---- the room

export function roomPlan({ width, height, depth, sceneWidth, unitWidth, specWidth, baggeboWidth, unitCount, floorY }) {
  const unitScale = unitWidth / specWidth, unitGap = 24 * unitScale
  const centers = []
  for (let index = 0; index < unitCount; index++) centers.push(-width / 2 + unitWidth / 2 + index * (unitWidth + unitGap))
  const roomSpan = Math.max(width, height, sceneWidth) * 24
  return { unitScale, unitGap, centers, floor:[width + 210, depth + 210], floorPosition:[55, floorY - 1, -depth / 2 + 45], roomSpan,
    wall:[0, -height / 2, -depth - 28 * unitWidth / baggeboWidth] }
}
export function trashStand({ width, depth, radius, boundsMin, wallZ, floorY, gap }) {
  const z = Math.max(-depth, wallZ - boundsMin.z + gap)
  return [width / 2 + gap + radius, floorY - boundsMin.y, z]
}
