// User-timing marks for the book opening timeline (select -> engine opened ->
// page prepared -> open tap -> first frame). Cheap, never throws, and readable
// from DevTools or a test with performance.getEntriesByType('mark').

const PREFIX = 'ihr:'

/** Starts a fresh timeline: only the latest selection is worth keeping. */
export function resetTimeline() {
  try {
    for (const entry of performance.getEntriesByType('mark')) {
      if (entry.name.startsWith(PREFIX)) performance.clearMarks(entry.name)
    }
  } catch { /* no User Timing */ }
}

export function markTiming(name, detail) {
  try { performance.mark(PREFIX + name, detail === undefined ? undefined : { detail }) } catch { /* no User Timing */ }
}
