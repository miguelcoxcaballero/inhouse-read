/** An Android inbox import needs the reader before it needs an unseen room.
 * Keep the requested shelf refresh until home is visible again. */
export function createNativeImportShelfGate({ isReaderVisible, refresh }) {
  let active = false, pending = false;
  return {
    setActive(value) {
      active = Boolean(value);
      if (active) pending = true;
      else if (pending && !isReaderVisible()) {
        pending = false;
        refresh();
      }
    },
    deferRefresh() {
      if (active || (pending && isReaderVisible())) return true;
      pending = false;
      return false;
    }
  };
}
