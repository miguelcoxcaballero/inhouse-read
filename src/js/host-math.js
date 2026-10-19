// Host side of rust-core/src/host_math.rs. A kernel that needs a sine, cosine, power or hypotenuse
// (or an arctangent) writes (operation, a, b) triples; this fills one result per request from the engine's own
// Math, so the page gets the numbers its JavaScript always got. The views are made here, after
// the kernel returned, because nothing may be held across a call that can grow the memory.
export function resolveHostMath(core, requests, results, count) {
  const asked = new Float64Array(core.memory.buffer, requests, count * 3);
  const answered = new Float64Array(core.memory.buffer, results, count);
  for (let i = 0; i < count; i++) {
    const a = asked[i * 3 + 1];
    switch (asked[i * 3]) {
      case 0: answered[i] = Math.sin(a); break;
      case 1: answered[i] = Math.cos(a); break;
      case 2: answered[i] = Math.pow(a, asked[i * 3 + 2]); break;
      case 3: answered[i] = Math.hypot(a, asked[i * 3 + 2]); break;
      case 5: answered[i] = Math.atan2(a, asked[i * 3 + 2]); break;
      default: break; // not asked for this input
    }
  }
}
