// The hits of a ray in the order `Raycaster.intersectObjects(objects, true)` returns them (nearest first; equal
// distances in traversal order), handed to `visit` one at a time until it returns something other than undefined.
// A tap only needs the hits up to the first that decides it: a mesh whose vertices' box the ray enters farther than
// every hit already decided is never tested triangle by triangle. On the BAGGEBO shelf this skips its
// open expanded steel (60 000 triangles behind the books, 8-13 ms per tap at no hit).
//
// Exactness: every triangle of a mesh lies inside the box of its current vertex positions, so a hit's distance from
// the ray's origin is at least where the ray enters that box (less a margin for rounding). A hit is visited only
// once no mesh still untested can enter closer, so the visits are the same, in the same order, as walking the sorted
// full list. The box is this module's own, kept per geometry and remade whenever its positions change (never the
// geometry's boundingBox/Sphere, which nothing guarantees to be current); three's own early outs still apply,
// unchanged, inside each mesh's raycast. Only plain meshes are bounded; any other object (instanced, skinned,
// morphed, lines, points, sprites, an overridden raycast) and any ray with a near plane is tested before any hit is
// visited, exactly as the full list would.
import { Box3, Matrix4, Mesh, Ray, Vector3 } from 'three'

const local = new Ray(), inverse = new Matrix4(), entry = new Vector3()
// Relative margin of a bound: far above float rounding at the shelf's scale (distances ~1e4), far below any gap
// between two surfaces a finger could tell apart.
const MARGIN = 1e-5
// geometry -> { positions, version, box }: a few dozen boxes for a whole room.
const boxes = new WeakMap()

function positionBox(geometry) {
  const positions = geometry.attributes?.position
  if (!positions) return null
  const version = positions.isInterleavedBufferAttribute ? positions.data.version : positions.version
  let known = boxes.get(geometry)
  if (known?.positions !== positions || known.version !== version) {
    known = { positions, version, box:new Box3().setFromBufferAttribute(positions) }
    boxes.set(geometry, known)
  }
  return known.box
}

/** Where the ray can first meet `object`'s own triangles (0 when unknown, Infinity when it cannot). */
function lowerBound(raycaster, object) {
  if (!object.isMesh || object.raycast !== Mesh.prototype.raycast || object.isSkinnedMesh || object.isInstancedMesh ||
    object.morphTargetInfluences?.length || object.material === undefined || raycaster.near !== 0) return 0
  const box = positionBox(object.geometry)
  if (!box) return 0
  if (box.isEmpty()) return Infinity
  inverse.copy(object.matrixWorld).invert()
  local.copy(raycaster.ray).applyMatrix4(inverse)
  if (box.containsPoint(local.origin)) return 0
  if (!local.intersectBox(box, entry)) return Infinity
  const bound = raycaster.ray.origin.distanceTo(entry.applyMatrix4(object.matrixWorld))
  // Never below 0: a parent whose own test may stop its children (bound 0) is tested before any of them.
  return Math.max(0, bound - MARGIN * Math.max(1, bound))
}

// Scratch: the candidates of one call and the hits waiting for their turn. Callers never nest.
const candidates = [], pending = []
let sequence = 0

function collect(raycaster, object) {
  // As Raycaster's intersect(): layers gate the object's own test, `false` stops its children.
  const tested = object.layers.test(raycaster.layers)
  if (tested) candidates.push({ object, order:sequence++, bound:lowerBound(raycaster, object), skipped:false })
  for (const child of object.children) collect(raycaster, child)
}

const byDistance = (a, b) => a.hit.distance - b.hit.distance || a.order - b.order || a.index - b.index

/**
 * Visits the hits of `raycaster` against `objects` (recursively) nearest first, as the sorted list of
 * `raycaster.intersectObjects(objects, true)` would, until `visit(hit)` returns a value other than undefined,
 * which is returned. Returns undefined when every hit was visited.
 */
export function visitRayHits(raycaster, objects, visit) {
  candidates.length = 0; pending.length = 0; sequence = 0
  for (const object of objects) collect(raycaster, object)
  candidates.sort((a, b) => a.bound - b.bound || a.order - b.order)
  try {
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (candidate.skipped) continue
      const found = []
      if (candidate.object.raycast(raycaster, found) === false) skipDescendants(candidate.object)
      for (let index = 0; index < found.length; index++) pending.push({ hit:found[index], order:candidate.order, index })
      pending.sort(byDistance)
      // Hits nearer than anything still untested are in their final order.
      const next = nextBound(i + 1)
      let taken = 0
      while (taken < pending.length && pending[taken].hit.distance < next) {
        const result = visit(pending[taken++].hit)
        if (result !== undefined) return result
      }
      pending.splice(0, taken)
    }
    for (const { hit } of pending) { const result = visit(hit); if (result !== undefined) return result }
    return undefined
  } finally { candidates.length = 0; pending.length = 0 }
}

function nextBound(from) {
  for (let i = from; i < candidates.length; i++) if (!candidates[i].skipped) return candidates[i].bound
  return Infinity
}

// Children of an object whose raycast returned false are never tested (Raycaster's propagate).
function skipDescendants(object) {
  const hidden = new Set()
  object.traverse(child => { if (child !== object) hidden.add(child) })
  for (const candidate of candidates) if (hidden.has(candidate.object)) candidate.skipped = true
}
