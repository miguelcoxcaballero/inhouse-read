// One native canvas remains owned until its real output
// changes hands. Foreign renderers finish their paint AND export before the
// visible owner restores its frame; no second WebGL context is created here.
const nativeOwners = new WeakMap();
const leaseStates = new WeakMap();
const restoring = new WeakSet();
const lazySnapshots = new WeakMap();
let snapshotCopyHookInstalled = false;
function positionAtomically(node, position) {
  const parent = node.parentNode, sibling = node.nextSibling, style = node.style.cssText,
    name = node.className, hidden = node.getAttribute('aria-hidden');
  try { if (position(node) !== false) return true; } catch { /* retain the previous presenter */ }
  node.style.cssText = style; node.className = name;
  if (hidden == null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden',hidden);
  if (parent) parent.insertBefore(node,sibling?.parentNode === parent ? sibling : null);
  else node.remove();
  return false;
}

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

export const currentNativeRendererPresentation = renderer => nativeOwners.get(renderer) || null;

/** Synchronous render+copy transaction; restoration happens after the copy. */
export function withRendererPresentation(renderer, consumer, drawTask) {
  const owner = nativeOwners.get(renderer);
  try {
    const result = drawTask();
    if (result && typeof result.then === 'function') throw new TypeError('Renderer paint tasks must be synchronous');
    return result;
  } finally {
    // A complete insertion may have transferred to the room inside this task.
    // Restoring that outgoing book would overwrite the new room's actual pixels.
    if (owner && owner !== consumer && nativeOwners.get(renderer) === owner && !restoring.has(renderer)) {
      restoring.add(renderer);
      try { owner.repaint(); } finally { restoring.delete(renderer); }
    }
  }
}

/**
 * capture(context) materializes the exact retained displayed frame into the
 * supplied raw output context. repaint() restores that same GPU frame without
 * advancing a clock or acquiring another lease. position(node) attaches and
 * styles the renderer's existing canvas, returning false if it cannot present.
 */
export function createNativeRendererPresentation(renderer, { canvas,context,capture,repaint,position,cleanup }) {
  if (!renderer?.domElement || !canvas || !context || typeof capture !== 'function' ||
    typeof repaint !== 'function' || typeof position !== 'function') return null;
  const state = { renderer,canvas,context,capture,repaint,position,cleanup,disposed:false,revision:1,materialized:0,capturing:false };
  const lease = {
    canvas,
    isOwner:() => !state.disposed && nativeOwners.get(renderer) === lease,
    markDirty() { if (!state.disposed) state.revision++; },
    present() {
      if (state.disposed) return false;
      const owner = nativeOwners.get(renderer);
      if (owner && owner !== lease) return false;
      if (!positionAtomically(renderer.domElement,state.position)) return false;
      nativeOwners.set(renderer,lease); canvas.style.opacity='0';
      return true;
    },
    repaint() {
      if (!state.disposed) return state.repaint();
    },
    capture() {
      if (state.disposed || state.capturing || state.materialized === state.revision) return;
      const revision = state.revision;
      state.capturing=true;
      try {
        withRendererPresentation(renderer,lease,() => state.capture(context));
        state.materialized=revision;
      } finally { state.capturing=false; }
    },
    transferTo(next) {
      const target = leaseStates.get(next);
      if (!lease.isOwner() || !target || target.disposed || target.renderer !== renderer) return false;
      if (!positionAtomically(renderer.domElement,target.position)) return false;
      nativeOwners.set(renderer,next); target.canvas.style.opacity='0';
      return true;
    },
    release({ snapshot=true } = {}) {
      if (state.disposed) return;
      if (snapshot) lease.capture();
      if (nativeOwners.get(renderer) === lease) {
        renderer.domElement.remove(); nativeOwners.delete(renderer);
      }
      // A pending or transferred lease never exposes an older 2D snapshot.
      // Only an explicit successful snapshot release presents those pixels.
      if (snapshot) canvas.style.opacity='';
    },
    dispose({ snapshot=false } = {}) {
      if (state.disposed) return;
      lease.release({ snapshot }); state.disposed=true; state.cleanup?.();
    }
  };
  leaseStates.set(lease,state);
  return lease;
}
