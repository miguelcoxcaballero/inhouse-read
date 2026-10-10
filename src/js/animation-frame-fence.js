// One in-flight GPU frame per book animation. A zero-time fence poll leaves
// input and the compositor free while a slow driver finishes that frame.
// Missing/lost contexts retain the existing RAF path; there is no finish/readback.
export function animationFrameFence(gl) {
  let sync = null, usable = ['fenceSync','clientWaitSync','deleteSync','flush']
    .every(name => typeof gl?.[name] === 'function');
  const release = () => {
    const previous = sync; sync = null;
    if (previous) try { gl.deleteSync(previous); } catch { usable = false; }
  };
  return {
    ready() {
      if (!sync) return true;
      try {
        if (gl.isContextLost?.()) { release(); usable = false; return true; }
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) return false;
        if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) usable = false;
      } catch { usable = false; }
      release(); return true;
    },
    submit() {
      if (!usable) return;
      release();
      try { sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); if (sync) gl.flush(); else usable = false; }
      catch { release(); usable = false; }
    },
    dispose:release
  };
}
