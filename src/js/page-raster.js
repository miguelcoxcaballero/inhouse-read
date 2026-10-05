// Only reader-produced copies of a settled PDF raster can share a texture.
// A margin colour, page number or caller-provided metadata is not pixel identity.
const copies = new WeakMap();
export function registerPageRaster(source, revision) {
  if (!source || !revision || typeof revision !== 'object' || !(source.width > 0 && source.height > 0)) return;
  copies.set(source, { revision, width:source.width, height:source.height });
}
export function pageRaster(source) {
  const record = source && copies.get(source);
  return record && record.width === source.width && record.height === source.height ? record.revision : null;
}
