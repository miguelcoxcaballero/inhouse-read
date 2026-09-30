/** The shared scene projects a binding target; the fallback uses the full box. */
export async function spinePointerPosition(spine, bounds) {
  if (await spine.getAttribute('data-scene-hit-surface') === 'spine')
    return { x:bounds.width / 2,y:bounds.height / 2 };
  return { x:Math.min(8,bounds.width * .12),y:bounds.height * .65 };
}
