// Browser scheduling adapter. Every numerical step executes in Rust.
import { loadedRustCore } from './rust-core.js';
import { createRustFontScorer } from './font-score-wasm.js';
export function* scoreFontMask(gray, near, width, height, rows, mask) {
  const scorer = createRustFontScorer(loadedRustCore(), {gray, near, width, height, rows});
  try { return yield* scorer.steps(mask); }
  finally { scorer.dispose(); }
}
