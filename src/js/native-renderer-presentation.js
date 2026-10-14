import { needRustShelf } from './rust-shelf.js';

// One native canvas remains owned until its real output changes hands. Foreign renderers finish
// their paint AND export before the visible owner restores its frame; no second WebGL context is
// created here. The ownership state machine (leases, transfers, restoration) runs in Rust
// (rust-ui/src/native_presentation.rs, the shelf module); only the 2D-context patch below needs
// JavaScript, because it replaces prototype methods that must see their own receiver.
const lazySnapshots = new WeakMap();
let snapshotCopyHookInstalled = false;

/** The existing book snapshot hooks, shared with native shelf exports. */
export function registerCanvasSnapshot(canvas, capture) {
  lazySnapshots.set(canvas,capture);
  if (!snapshotCopyHookInstalled && globalThis.CanvasRenderingContext2D) {
    const prototype=CanvasRenderingContext2D.prototype, drawImage=prototype.drawImage, getImageData=prototype.getImageData;
    prototype.drawImage=function(source,...args) {
      lazySnapshots.get(source)?.();
      return drawImage.call(this,source,...args);
    };
    prototype.getImageData=function(...args) {
      lazySnapshots.get(this.canvas)?.();
      return getImageData.apply(this,args);
    };
    snapshotCopyHookInstalled=true;
  }
  // Disposing an old binding must not unregister its replacement's capture.
  return () => { if (lazySnapshots.get(canvas) === capture) lazySnapshots.delete(canvas); };
}

export const currentNativeRendererPresentation = renderer => needRustShelf().current_native_renderer_presentation(renderer);

/** Synchronous render+copy transaction; restoration happens after the copy. */
export const withRendererPresentation = (renderer, consumer, drawTask) => needRustShelf().with_renderer_presentation(renderer, consumer, drawTask);

// A lease's Rust half and its host parts, as the original kept its state: the parts stay with
// the lease, where the collector sees whatever the callbacks reach.
const leaseStates = new WeakMap();

/**
 * capture(context) materializes the exact retained displayed frame into the
 * supplied raw output context. repaint() restores that same GPU frame without
 * advancing a clock or acquiring another lease. position(node) attaches and
 * styles the renderer's existing canvas, returning false if it cannot present.
 * The lease is a plain object, so its holders compare and annotate it; each
 * method hands the lease itself and its parts to the Rust half.
 */
export function createNativeRendererPresentation(renderer, { canvas, context, capture, repaint, position, cleanup }) {
  if (!renderer?.domElement || !canvas || !context || typeof capture !== 'function' ||
    typeof repaint !== 'function' || typeof position !== 'function') return null;
  const native = new (needRustShelf().NativeLease)(), parts = { renderer, canvas, context, capture, repaint, position, cleanup };
  const lease = {
    canvas,
    isOwner:() => native.isOwner(lease, parts),
    markDirty:() => native.markDirty(),
    present:() => native.present(lease, parts),
    repaint:() => native.repaint(parts),
    capture:() => native.capture(lease, parts),
    transferTo(next) { const target = leaseStates.get(next); return native.transferTo(lease, parts, next, Boolean(target) && !target.native.disposed, target?.parts); },
    release:options => native.release(lease, parts, options),
    dispose:options => native.dispose(lease, parts, options)
  };
  leaseStates.set(lease, { native, parts });
  return lease;
}
