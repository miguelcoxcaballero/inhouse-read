// @vitest-environment node
import {expect,it,vi} from 'vitest';
vi.mock('../../src/js/rust-shelf.js',()=>({needRustShelf(){throw Error('shelf not ready')}}));
it('keeps physical tables, scale and spine options available without loading the shelf module',async()=>{
 const dimensions=await import('../../src/js/plant-dimensions.js');
 expect(dimensions.PLANT_SIZES.monstera).toBeDefined();expect(dimensions.POT_SIZES.muskot).toBeDefined();expect(dimensions.shelfScale({shelfWidth:390})).toBe(.65);expect(dimensions.bookSpineOptions(390).bindingThickness).toBe(2.6);
});
