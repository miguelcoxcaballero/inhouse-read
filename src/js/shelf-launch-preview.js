// Independent entry: it can paint from IndexedDB while the larger JS/WASM
// modules are still downloading. The normal scene owns all interactive UI.
import { launchState, launchKey, readLaunchFrame, validLaunchFrame } from './shelf-launch-cache.js';
const records = globalThis.__inhouseShelfPreviewRead;
delete globalThis.__inhouseShelfPreviewRead;
const root = document.getElementById('bookshelf-root');
let image, url, ended = false;
const live = () => Number(root?.querySelector('canvas.ihr-bookshelf-scene')?.dataset.renderCount) > 0;
const finish = () => {
  ended = true; observer.disconnect(); image?.remove();
  root?.classList.remove('has-launch-preview');
  root?.removeAttribute('aria-busy');
  if (url) URL.revokeObjectURL(url);
  removeEventListener('resize', finish); removeEventListener('pagehide', finish); removeEventListener('storage', finish);
};
const observer = new MutationObserver(() => { if (live()) finish(); });
if (root && records) {
  observer.observe(root, { childList:true, subtree:true, attributes:true, attributeFilter:['data-render-count'] });
  addEventListener('resize', finish, { once:true }); addEventListener('pagehide', finish, { once:true }); addEventListener('storage', finish, { once:true });
  void (async () => {
    try {
      const [books, frame] = await Promise.all([records, readLaunchFrame()]);
      if (!books || !frame || ended || live()) return finish();
      const state = launchState(books), key = await launchKey(state);
      if (ended || live() || !validLaunchFrame(frame, key, innerWidth, innerHeight)) return finish();
      image = new Image(); image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.className = 'ihr-launch-preview';
      url = URL.createObjectURL(frame.image); image.src = url;
      await image.decode();
      if (ended || live() || launchState(books).text !== state.text) return finish();
      Object.assign(image.style, { position:'fixed', pointerEvents:'none', left:`${frame.x}px`, top:`${frame.y}px`,
        width:`${frame.width}px`, height:`${frame.height}px`, zIndex:'1' });
      root.classList.add('has-launch-preview'); root.setAttribute('aria-busy', 'true'); document.body.append(image);
    } catch { finish(); }
  })();
}
