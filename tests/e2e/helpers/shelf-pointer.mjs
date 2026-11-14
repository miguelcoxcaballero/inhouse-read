/** The shared scene projects a binding target; the fallback uses the full box. */
export async function spinePointerPosition(spine, bounds) {
  if (await spine.getAttribute('data-scene-hit-surface') === 'spine')
    return { x:bounds.width / 2,y:bounds.height / 2 };
  return { x:Math.min(8,bounds.width * .12),y:bounds.height * .65 };
}

/** Presses a book where its binding is, with real mouse events. The shelf picks the book from the scene, not from the
 * DOM: the padded tap rectangles of thin neighbouring books overlap, so the topmost rectangle at a book's own centre can
 * be a neighbour's. A locator click refuses to press there ("intercepts pointer events") although the press selects the
 * right book; this waits for the rectangle to stand still, as a locator click does, and presses the same point. */
export async function clickSpine(spine) {
  await spine.waitFor({ state:'visible' })
  let bounds = await spine.boundingBox()
  for (let attempt = 0; attempt < 50; attempt++) {
    await spine.page().waitForTimeout(100)
    const next = await spine.boundingBox()
    const still = bounds && next && ['x', 'y', 'width', 'height'].every(key => Math.abs(bounds[key] - next[key]) < .5)
    bounds = next
    if (still) break
  }
  if (!bounds) throw new Error('The book has no rectangle to press')
  const position = await spinePointerPosition(spine, bounds)
  await spine.page().mouse.click(bounds.x + position.x, bounds.y + position.y)
}
