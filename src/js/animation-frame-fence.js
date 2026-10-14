import { needRustShelf } from './rust-shelf.js';

// One in-flight GPU frame per book animation. A zero-time fence poll leaves
// input and the compositor free while a slow driver finishes that frame.
// Missing/lost contexts retain the existing RAF path; there is no finish/readback.
// The fence's rules run in Rust (rust-ui/src/animation_fence.rs, the shelf module).
export function animationFrameFence(gl) {
  const fence = new (needRustShelf().AnimationFrameFence)(gl);
  return { ready:() => fence.ready(), submit:() => fence.submit(), dispose:() => fence.dispose() };
}
