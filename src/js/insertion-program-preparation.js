import { prelinkPrograms, prepareProgramUniforms } from './gpu-programs.js';

/** Prepare the hidden placement/depth programs after the room's first paint.
 * No geometry is drawn or changed; disposal cancels every deferred slice. */
export async function prepareInsertionPrograms(renderer, scene, camera, roots, { idle, current, onLinked } = {}) {
  if (typeof idle !== 'function' || typeof current !== 'function') return false;
  await idle();
  if (!current()) return false;
  prelinkPrograms(renderer, scene, camera, roots);
  onLinked?.();
  const materials = new Set();
  for (const root of roots) root.traverseVisible(object => {
    if (!(object.isMesh || object.isPoints || object.isLine)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (material) materials.add(material);
  });
  return prepareProgramUniforms(renderer, materials, { idle, current });
}
