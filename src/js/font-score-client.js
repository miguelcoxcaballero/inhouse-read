import { getRustCoreModule } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';
// The client of the font-score Worker (one module Worker shared by every caller, one job and one request at a
// time, the 3 s / 2 s / 30 s bounds and the validation of every reply) is rust-ui/src/font_score_client.rs.
// This module only names the Worker, so the bundler ships it.
const createWorker = () => new Worker(new URL('./font-score-worker.js', import.meta.url), { type:'module' });

export async function openFontScoreJob(context, { factory = createWorker, events = globalThis } = {}) {
  if (factory === createWorker && typeof Worker !== 'function') return null;
  return needRustShelf().font_score_open(context, factory, events, getRustCoreModule);
}
