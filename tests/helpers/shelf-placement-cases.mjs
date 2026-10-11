export const placementApis = ['layout', 'move', 'decorations', 'move-decorations'];
export const placementSettings = api => ({ move:api.startsWith('move'), separateMounts:api.includes('decorations') });
export function generatePlacement(seed, count, { unusual = false } = {}) {
  let value = seed >>> 0;
  const random = () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
  const odd = [undefined, null, NaN, Infinity, -Infinity, -0, -3, '', '32', .001, 1, 99];
  const objects = Array.from({ length:count }, (_, index) => {
    const kind = index % 7 === 0 ? 'lamp' : index % 4 === 0 ? 'plant' : 'book';
    const object = { key:`${kind}:${seed}:${index}`, kind, width:12 + Math.floor(random() * 65),
      shelf:Math.floor(random() * Math.max(1, Math.ceil(count / 8))), x:random(),
      title:`Árbol 🪴 ${index}`, metadata:{ identity:index, retain:true }, book:{ id:`b:${index}` } };
    if (kind === 'lamp') object.mount = index % 14 === 0 ? 'undershelf' : 'floor';
    if (index % 6 === 0) delete object.x;
    if (unusual) {
      if (index % 5 === 0) object.width = odd[Math.floor(random() * odd.length)];
      if (index % 9 === 0) object.x = odd[Math.floor(random() * odd.length)];
      if (index % 11 === 0) object.shelf = odd[Math.floor(random() * odd.length)];
      if (index % 13 === 0) object.key = index ? undefined : '';
    }
    return object;
  });
  // Duplicate keys on the same and different mounting surfaces are deliberate.
  if (unusual && objects.length > 14) {
    objects[14].key = objects[1].key; objects[13].key = objects[1].key;
    objects[2].style = { width:41, retain:true }; delete objects[2].width;
    objects[3].displayWidth = 37; delete objects[3].width;
  }
  const options = { shelfWidth:[240,320,390,600,1024][seed % 5], padding:[0,16,23.5][seed % 3],
    gap:[0,3,1.25][seed % 3], minShelves:seed % 4, placements:{} };
  for (let index = 1; index < objects.length; index += 7) options.placements[objects[index].key] = {
    shelf:Math.floor(index / 8), x:random() };
  options.placements.deleted = { shelf:999, x:.8 };
  return { objects, options, movedKey:objects.find(object => object.key)?.key || 'missing',
    target:{ shelf:seed % 4, x:(seed % 101) / 100 } };
}
export const placementBenchCases = [
  ...[0,1,10,40,200,1000].flatMap(count => ['layout','move-decorations'].map(api => ({ name:`${api}-${count}`, api, count, seed:41 }))),
  { name:'decorations-independent-mounts-80', api:'decorations', count:80, seed:59 },
  { name:'plain-pinned-overflow-200', api:'move', count:200, seed:83 },
  { name:'drag-sequence-40', api:'move-decorations', count:40, seed:67, sequence:120 },
];
export function placementFixture(input) { return generatePlacement(input.seed, input.count); }
export function originalPlacement(plain, decoration, input, api, target = input.target) {
  if (api === 'layout') return plain.layoutShelvedObjects(input.objects, input.options);
  if (api === 'move') return plain.moveShelfObject(input.objects, input.movedKey, target, input.options);
  if (api === 'decorations') return decoration.layoutShelfDecorations(input.objects, input.options);
  return decoration.moveShelfDecoration(input.objects, input.movedKey, target, input.options);
}
