import { beforeAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { renderBookshelf } from '../../src/js/bookshelf.js';
import { loadPlantCatalogModule } from '../../src/js/plant-catalog-lazy.js';

const studio = vi.hoisted(() => ({ prepare:vi.fn(), open:vi.fn(), destroy:vi.fn() }));
vi.mock('../../src/js/plant-catalog.js', () => ({ createPlantCatalog:() => ({
  ...studio, setShelfType:vi.fn()
}) }));
beforeAll(async () => { await loadPlantCatalogModule(); });
let container, shelf;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => {
  shelf?.destroy(); shelf = null; container.remove();
  vi.useRealTimers(); localStorage.clear();
});
it('prefetches the isometric catalogue without building a hidden GPU studio', async () => {
  shelf = renderBookshelf(container, [], { shelfWidth:390, viewMode:'isometric' });
  await vi.advanceTimersByTimeAsync(8000);
  expect(studio.prepare).not.toHaveBeenCalled();
  expect(studio.open).not.toHaveBeenCalled();
  container.querySelector('.ihr-shelf-catalog').click();
  expect(studio.open).toHaveBeenCalledOnce();
});
it('does not build a hidden studio when switching to the diagonal view', async () => {
  shelf = renderBookshelf(container, [], { shelfWidth:390 });
  shelf.element.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowLeft', bubbles:true, cancelable:true }));
  await vi.advanceTimersByTimeAsync(8000);
  expect(studio.prepare).not.toHaveBeenCalled();
  expect(studio.open).not.toHaveBeenCalled();
});
