export function sampleBookMotion(frames, progress) {
  const times = frames.map((frame, i) => frame.offset ?? i / (frames.length - 1));
  const t = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < frames.length - 2 && t > times[index + 1]) index++;
  const span = times[index + 1] - times[index], k = (t - times[index]) / span;
  const k2 = k * k, k3 = k2 * k, pose = {};
  for (const key of ['x', 'y', 'scale', 'angle', 'pitch', 'roll', 'coverOpen', 'bookmarkWithdraw', 'pageTheme']) {
    // The page's stock/theme mix only moves when every frame says where it goes.
    if (key === 'pageTheme' && frames.some(frame => frame.transform.pageTheme == null)) continue;
    const value = i => frames[i].transform[key] ?? 0;
    const tangent = i => {
      if (i === 0 || i === frames.length - 1) return 0;
      const dt0 = times[i] - times[i - 1], dt1 = times[i + 1] - times[i];
      const a = (value(i) - value(i - 1)) / dt0, b = (value(i + 1) - value(i)) / dt1;
      if (a * b <= 0) return 0;
      const w0 = 2 * dt1 + dt0, w1 = dt1 + 2 * dt0;
      return (w0 + w1) / (w0 / a + w1 / b);
    };
    pose[key] = (2 * k3 - 3 * k2 + 1) * value(index) + (k3 - 2 * k2 + k) * span * tangent(index)
      + (-2 * k3 + 3 * k2) * value(index + 1) + (k3 - k2) * span * tangent(index + 1);
  }
  return pose;
}

/** The clock of the original animateMotion callback (book-model.js before the core owned it):
 * real time, a stalled frame absorbs at most 100 ms, and the first step only covers the frame
 * that scheduled the motion. Returns the callback: now => progress. */
export function originalClock(duration, startedAt) {
  let lastFrame = startedAt, elapsed = 0, started = false;
  const maxStep = Math.max(48, Math.min(100, duration / 2));
  return now => {
    elapsed += Math.min(started ? maxStep : 48, Math.max(0, now - lastFrame)); lastFrame = now; started = true;
    return duration > 0 ? Math.min(1, elapsed / duration) : 1;
  };
}
