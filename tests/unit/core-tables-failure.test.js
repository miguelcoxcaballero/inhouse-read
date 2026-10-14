// The shelf's tables come from the Rust cores and have no JavaScript copy. When
// a core cannot be loaded the person must get a readable message (as for any
// other chunk that fails to load), not a blank page that fails silently.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MESSAGE = 'No se pudo cargar la estantería. Comprueba la conexión e inténtalo de nuevo.';
let reload;
beforeEach(() => {
  document.body.innerHTML = '<div id="bookshelf-root"><p>poster</p></div>';
  sessionStorage.clear();
  reload = vi.fn();
  vi.stubGlobal('location', { ...globalThis.location, reload, href: 'http://localhost/inhouse-read/' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function failWith(setup, moduleUrl) {
  vi.resetModules();
  setup();
  return await import(/* @vite-ignore */ moduleUrl).then(() => null, error => error);
}
const offline = () => {
  delete globalThis.__inhouseRustReady; delete globalThis.__inhouseDecorReady;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline first visit'); }));
};

describe('shelf tables without their core', () => {
  for (const [name, url] of [['app', '../../src/js/catalogue-core.js'], ['decor', '../../src/js/decor-catalogue.js']]) {
    it(`reports an unreachable ${name} core with the readable message, a note and one reload`, async () => {
      const error = await failWith(offline, url);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(MESSAGE);
      expect(error.cause).toBeInstanceOf(Error);
      expect(document.getElementById('bookshelf-root').textContent).toBe(MESSAGE);
      expect(document.querySelector('#bookshelf-root p').getAttribute('role')).toBe('alert');
      expect(reload).toHaveBeenCalledTimes(1);
      // A second failure within the minute only shows the message: no reload loop.
      const again = await failWith(offline, url);
      expect(again.message).toBe(MESSAGE);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  }

  it('reports a core that loads but lacks the tables (an older or foreign module)', async () => {
    const foreign = () => {
      globalThis.__inhouseRustReady = Promise.resolve({ exports: { core_abi_version: () => 1, core_domain: () => 0, memory: new WebAssembly.Memory({ initial: 1 }),
        alloc_f64: () => 8, free_f64: () => {} } });
    };
    const error = await failWith(foreign, '../../src/js/catalogue-core.js');
    expect(error.message).toBe(MESSAGE);
    expect(error.cause.message).toContain('catalogue_json');
  });

  it('survives a page without the shelf root or a document', async () => {
    document.body.innerHTML = '';
    const error = await failWith(offline, '../../src/js/catalogue-core.js');
    expect(error.message).toBe(MESSAGE);
  });
});
