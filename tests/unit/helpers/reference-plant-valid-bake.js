// Frozen original of the saved-bake check of src/js/shelf-plants.js (`validBake`, as in reference-shelf-plants.js),
// before it moved to the Rust shelf module (plant_valid_bake, rust-ui/src/plant_surface_queue.rs). A bake read back
// from IndexedDB is only used when this accepts it.
const KINDS = ['mesh', 'lines', 'group'];
const ROLES = ['clay', 'soil', 'leaf', 'stem', 'mineral', 'green', 'needles'];
const isTriple = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
// Typed arrays read back from IndexedDB may come from another realm.
const typeOf = value => Object.prototype.toString.call(value).slice(8, -1);
export function referenceValidBake(bake) {
  if (!bake || !Array.isArray(bake.parts) || !Array.isArray(bake.objects)) return false;
  return bake.objects.every((object, index, all) => {
    if (!KINDS.includes(object?.kind) || typeof object.name !== 'string' || !isTriple(object.position) || !isTriple(object.scale) ||
      !Array.isArray(object.quaternion) || object.quaternion.length !== 4 || !object.quaternion.every(Number.isFinite) ||
      !Array.isArray(object.rotation) || !isTriple(object.rotation.slice(0, 3)) || !Number.isInteger(object.place)) return false;
    if (object.parent !== -1 && all[object.parent]?.kind !== 'group') return false;
    if (object.kind === 'group') return true;
    const geometry = object.geometry;
    if (!ROLES.includes(object.role) || !geometry?.attributes?.position) return false;
    const count = geometry.attributes.position[0]?.length / geometry.attributes.position[1];
    return Number.isInteger(count) && Object.values(geometry.attributes).every(([array, itemSize]) =>
      /^(Float32|U?Int(8|16|32))Array$/.test(typeOf(array)) && Number.isInteger(itemSize) && itemSize > 0 && array.length === count * itemSize) &&
      (geometry.index === null || /^Uint(16|32)Array$/.test(typeOf(geometry.index))) &&
      Array.isArray(geometry.groups) && (geometry.box === null || Array.isArray(geometry.box) && geometry.box.length === 6);
  });
}
