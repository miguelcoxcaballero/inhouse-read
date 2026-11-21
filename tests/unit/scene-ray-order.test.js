import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { visitRayHits } from '../../src/js/scene-ray-order.js'
import { mulberry32 } from './helpers/scene-differential.js'

// A room of random meshes: boxes, planes and dense grids (as the BAGGEBO steel), nested groups, some
// transformed, some sharing geometries, some with their bounding boxes computed, an instanced mesh and a
// mesh on another layer; rays through it from random camera points.
function room(random) {
  const root = new THREE.Group(), objects = []
  const material = new THREE.MeshBasicMaterial({ side:THREE.DoubleSide })
  const shared = new THREE.BoxGeometry(1, 2, 0.3)
  const geometry = () => {
    const kind = Math.floor(random() * 4)
    if (kind === 0) return shared
    if (kind === 1) return new THREE.BoxGeometry(random() * 3 + 0.1, random() * 3 + 0.1, random() * 3 + 0.1)
    if (kind === 2) return new THREE.PlaneGeometry(random() * 6 + 1, random() * 6 + 1, 40, 40)
    return new THREE.SphereGeometry(random() + 0.2, 12, 8)
  }
  const place = object => {
    object.position.set(random() * 10 - 5, random() * 10 - 5, random() * 10 - 5)
    object.rotation.set(random() * 6, random() * 6, random() * 6)
    const scale = random() * 2 + 0.3
    object.scale.set(scale, scale * (random() + 0.5), scale)
    return object
  }
  for (let i = 0; i < 14; i++) {
    const group = place(new THREE.Group())
    for (let j = 0, count = 1 + Math.floor(random() * 4); j < count; j++) {
      const mesh = place(new THREE.Mesh(geometry(), material))
      if (random() < 0.5) mesh.geometry.computeBoundingBox()
      if (random() < 0.2) mesh.add(place(new THREE.Mesh(geometry(), material)))
      if (random() < 0.1) mesh.layers.set(2)
      group.add(mesh)
    }
    root.add(group)
    objects.push(group)
  }
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 3)
  for (let i = 0; i < 3; i++) instanced.setMatrixAt(i, new THREE.Matrix4().compose(
    new THREE.Vector3(random() * 8 - 4, random() * 8 - 4, random() * 8 - 4), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)))
  root.add(instanced); objects.push(instanced)
  root.updateMatrixWorld(true)
  return { root, objects }
}

const key = hit => [hit.object.id, hit.distance, hit.faceIndex, hit.instanceId ?? -1].join(':')

describe('visitRayHits', () => {
  it('visits the hits of intersectObjects in its order, and stops where asked', () => {
    const random = mulberry32(20261120)
    let compared = 0, stops = 0
    for (let scene = 0; scene < 12; scene++) {
      const { objects } = room(random)
      for (let ray = 0; ray < 40; ray++) {
        const raycaster = new THREE.Raycaster()
        const origin = new THREE.Vector3(random() * 30 - 15, random() * 30 - 15, 20 + random() * 10)
        const target = new THREE.Vector3(random() * 6 - 3, random() * 6 - 3, random() * 6 - 3)
        raycaster.set(origin, target.sub(origin).normalize())
        const expected = raycaster.intersectObjects(objects, true).map(key)
        const visited = []
        expect(visitRayHits(raycaster, objects, hit => { visited.push(key(hit)) })).toBeUndefined()
        expect(visited).toEqual(expected)
        compared += expected.length
        if (expected.length > 1) {
          const at = Math.floor(random() * expected.length), seen = []
          const answer = visitRayHits(raycaster, objects, hit => { seen.push(key(hit)); return seen.length - 1 === at ? hit : undefined })
          expect(seen).toEqual(expected.slice(0, at + 1))
          expect(key(answer)).toBe(expected[at])
          stops++
        }
      }
    }
    expect(compared).toBeGreaterThan(300)
    expect(stops).toBeGreaterThan(50)
  })

  it('orders by the current vertices, not by stale or missing geometry bounds', () => {
    const material = new THREE.MeshBasicMaterial({ side:THREE.DoubleSide })
    const near = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    const far = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 30, 30), material)
    near.position.z = 1; far.position.z = -1
    far.geometry.computeBoundingBox(); far.geometry.computeBoundingSphere()
    const scene = new THREE.Group(); scene.add(near, far); scene.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0.3, 0.2, 10), new THREE.Vector3(0, 0, -1))
    const first = () => visitRayHits(raycaster, [scene], hit => hit)
    expect(first().object).toBe(near)
    // The far plane's vertices move in front of the near one; its stored bounds still say it is behind.
    const positions = far.geometry.attributes.position
    for (let i = 0; i < positions.count; i++) positions.setZ(i, 3)
    positions.needsUpdate = true
    const expected = raycaster.intersectObjects([scene], true)
    expect(expected[0].object).toBe(far)
    expect(first().object).toBe(far)
    const visited = []
    visitRayHits(raycaster, [scene], hit => { visited.push(key(hit)) })
    expect(visited).toEqual(expected.map(key))
    // And back again.
    for (let i = 0; i < positions.count; i++) positions.setZ(i, -3)
    positions.needsUpdate = true
    expect(first().object).toBe(near)
  })

  it('never tests a dense mesh behind the deciding hit', () => {
    const material = new THREE.MeshBasicMaterial()
    const front = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(20, 20, 200, 200), material)
    grid.position.z = -10
    const scene = new THREE.Group(); scene.add(grid, front); scene.updateMatrixWorld(true)
    let tested = 0
    const raycast = grid.raycast.bind(grid)
    grid.raycast = (...args) => { tested++; return raycast(...args) }
    // An overridden raycast is not bounded; the plain one is.
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0.1, 0.1, 10), new THREE.Vector3(0, 0, -1))
    expect(visitRayHits(raycaster, [scene], hit => hit.object).id).toBe(front.id)
    expect(tested).toBe(1)
    grid.raycast = THREE.Mesh.prototype.raycast
    const spy = []
    const original = THREE.Mesh.prototype._computeIntersections
    THREE.Mesh.prototype._computeIntersections = function (...args) { spy.push(this.id); return original.apply(this, args) }
    try { expect(visitRayHits(raycaster, [scene], hit => hit.object).id).toBe(front.id) }
    finally { THREE.Mesh.prototype._computeIntersections = original }
    expect(spy).toEqual([front.id])
    // Without the front book the grid is tested and hit.
    scene.remove(front)
    expect(visitRayHits(raycaster, [scene], hit => hit.object).id).toBe(grid.id)
  })
})
