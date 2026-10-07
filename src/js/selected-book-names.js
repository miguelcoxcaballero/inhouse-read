// Only the selected book's editable names are reconciled at reader handoff.
// Its original bytes, position, layout and document metadata stay with the engine.
export function refreshSelectedBookNames(experience, book) {
  if (!book || book.id == null) return;
  const fields = Object.fromEntries(['spineTitleOverride', 'author']
    .filter(key => Object.hasOwn(book, key) && book[key] !== undefined)
    .map(key => [key, book[key]]));
  return experience?.refreshNames?.(book.id, fields);
}
