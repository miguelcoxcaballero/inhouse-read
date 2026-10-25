import { prepareInsertionProgramState } from './gpu-programs.js';

/** Prepare the hidden placement/depth programs after the room's first paint.
 * No geometry is drawn or changed; disposal cancels every deferred slice. */
export async function prepareInsertionPrograms(renderer, scene, camera, roots, { idle, current, onLinked } = {}) {
  return prepareInsertionProgramState(renderer, scene, camera, roots, idle, current, onLinked);
}
