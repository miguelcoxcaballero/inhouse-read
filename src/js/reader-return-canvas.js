// Reader snapshots own their pixels: both PDF routes and Foliate produce a
// fresh outer-document canvas before closing the engine. The still-page layer
// can display that canvas directly while WebGL uses it as an unchanged texture.
// A second DOM owner (the non-WebGL book) still needs its own exact copy.
export function readerReturnCanvas(source, { reuseDetached = false } = {}) {
  if (reuseDetached && typeof HTMLCanvasElement !== 'undefined' &&
      source instanceof HTMLCanvasElement && source.parentNode === null) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}
