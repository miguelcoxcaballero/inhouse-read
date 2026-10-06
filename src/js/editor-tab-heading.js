// The active tab is the visible section heading, with one shared hit target.
// Wrapping the existing button preserves its id, handlers and tab order.
export function setEditorTabHeading(heading, button) {
  if (!heading || !button || heading.firstElementChild === button) return;
  const previous = heading.firstElementChild;
  const focused = heading.ownerDocument.activeElement;
  if (previous) heading.replaceWith(previous);
  else heading.remove();
  button.replaceWith(heading);
  heading.replaceChildren(button);
  if (focused === previous || focused === button) focused?.focus({ preventScroll:true });
}
