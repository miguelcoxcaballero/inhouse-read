// PDF.js 6.3.289 records standalone image placements but omits the optimized
// repeated/grouped path. Reflow and theme masks need every painted placement.
const version='const version = "6.3.289";';
const groupPattern=/  paintInlineImageXObjectGroup\(opIdx, imgData, map\) \{\r?\n[\s\S]*?\r?\n  \}\r?\n  paintSolidColorImageMask/g;
const marker='      this.dependencyTracker?.recordBBox(opIdx, ctx, 0, 1, -1, 0);';
export function patchPDFImageTracking(source) {
  const groups=[...source.matchAll(groupPattern)];
  if(source.split(version).length!==2||groups.length!==1)
    throw Error('Unexpected PDF.js version or image group: review repeated-image tracking before building.');
  const original=groups[0][0],group=original.replaceAll('\r\n','\n');
  if(group.split(marker).length!==2||group.includes('this.imagesTracker'))
    throw Error('Unexpected PDF.js grouped image tracking: review before building.');
  const patched=group.replace(marker,marker+'\n      if (this.dependencyTracker) this.imagesTracker?.record(ctx, 1, 1, this.dependencyTracker.clipBox);');
  return source.slice(0,groups[0].index)+patched+source.slice(groups[0].index+original.length);
}
export function pdfImageTrackingPatch() {
  return {name:'inhouse-read-pdf-repeated-images',enforce:'pre',transform(source,id){
    const path=id.split('?')[0].replaceAll('\\','/');
    if(!path.endsWith('/node_modules/pdfjs-dist/legacy/build/pdf.mjs'))return null;
    return {code:patchPDFImageTracking(source),map:null};
  }};
}
