// Everything an object tree carries into a frame, for differential tests of models built from Rust packets:
// per node its class, name, transform, draw groups, every attribute byte and index, and the material's
// complete serialisation. Uuids (random per object) are left out; texture references read 'texture'.
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('hex')
const scrub = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'uuid' || key === 'metadata' ? undefined
  : typeof item === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(item) ? 'texture' : item))

export function describeScene(root) {
  const out = [], materials = [], geometries = []
  const share = (list, value) => {
    if (!value) return -1
    if (!list.includes(value)) list.push(value)
    return list.indexOf(value)
  }
  root.traverse(node => {
    node.updateMatrix()
    const geometry = node.geometry
    out.push({
      type: node.type, name: node.name, parent: node.parent?.name ?? null, visible: node.visible,
      position: node.position.toArray(), rotation: node.rotation.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
      matrix: node.matrix.toArray(), renderOrder: node.renderOrder, shadow: [node.castShadow, node.receiveShadow], frustumCulled: node.frustumCulled,
      geometry: geometry && {
        type: geometry.type, groups: geometry.groups, drawRange: geometry.drawRange,
        index: geometry.index && { type: geometry.index.array.constructor.name, bytes: bytes(geometry.index.array) },
        attributes: Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.itemSize, attribute.normalized,
          attribute.array.constructor.name, bytes(attribute.array)])
      },
      material: node.material && scrub(node.material.toJSON()),
      // Which objects share one material or geometry.
      shared: [share(materials, node.material), share(geometries, geometry)]
    })
  })
  return out
}

/** Bit-exact comparison of two numbers or two arrays of numbers (signed zeros and NaN included). */
export const sameNumbers = (left, right) => left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
