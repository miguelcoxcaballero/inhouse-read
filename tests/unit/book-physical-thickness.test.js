import { describe, expect, it } from 'vitest';
import { spineStyleFor } from '../../src/js/bookshelf-layout.js';
import { bookSpineOptions, shelfScale } from '../../src/js/plant-dimensions.js';
import { shelfModelLayout } from '../../src/js/shelf-model-layout.js';

describe('paper thickness at shelf scale', () => {
  it.each([320, 390, 900])('maps physical paper to the same relative thickness on a %ipx shelf', width => {
    const scale = shelfScale({shelfWidth:width});
    for (const pages of [100, 300, 600, 900]) {
      const style = spineStyleFor({id:'edition',pageCount:pages},bookSpineOptions(width));
      expect(style.width/scale).toBeCloseTo(4+pages*.07,1);
    }
  });

  it('long books remain distinct beyond the old 900-page/45mm ceiling', () => {
    const widths = [600,900,1100].map(pageCount => spineStyleFor({pageCount},bookSpineOptions(600)).width);
    expect(widths).toEqual([46,67,81]);
  });

  it('same length has the same thickness regardless of ID or archive size', () => {
    const styles = [{id:'a',sizeBytes:90_000},{id:'b',sizeBytes:30_000_000}]
      .map(book => spineStyleFor({...book,wordCount:180_000},bookSpineOptions(390)));
    expect(styles[0].width).toBe(styles[1].width);
    expect(styles[0].width).toBeCloseTo(46*.65,2);
  });

  it('an unknown compressed EPUB gets the stable neutral size until its full text is counted', () => {
    const options = bookSpineOptions(600);
    expect(spineStyleFor({sizeBytes:16_000},options).width).toBe(26.4);
    expect(spineStyleFor({sizeBytes:16_000,wordCount:270_000},options).width).toBe(67);
  });

  it('changing length leaves the cover aspect and height untouched', () => {
    const options = bookSpineOptions(390), ratio=.705;
    const entries = [100,900].map(pageCount => {
      const style=spineStyleFor({id:'same',pageCount},options);
      return {shelf:0,x:60,height:172,width:172*ratio,thickness:style.width,style};
    });
    const result=shelfModelLayout({width:390,rows:[{}],entries},'walnut').entries;
    expect(result[0].height).toBe(result[1].height);
    expect(result[0].width/result[0].height).toBeCloseTo(ratio,8);
    expect(result[1].width/result[1].height).toBeCloseTo(ratio,8);
    expect(result[1].thickness).toBeGreaterThan(result[0].thickness*5);
  });
});
