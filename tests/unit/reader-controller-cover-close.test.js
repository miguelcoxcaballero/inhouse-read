import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cover:vi.fn() }));
vi.mock('../../src/js/readers/pdf-reader.js', () => ({ PdfReader:class {
  open = vi.fn(async () => {}); close = vi.fn(); getCoverBlob = state.cover;
} }));
import { ReaderController } from '../../src/js/readers/reader-controller.js';
const open = async () => {
  const reader = new ReaderController();
  await reader.open(document.createElement('div'),new File(['%PDF-1.4'],'cover.pdf'));
  return reader;
};
beforeEach(() => state.cover.mockReset());
describe('cover render cancellation through the reader controller', () => {
  it('forwards the same signal and full quality successful result', async () => {
    const reader = await open(), controller = new AbortController(), blob = new Blob(['HD']);
    state.cover.mockResolvedValue(blob);
    expect(await reader.getCoverBlob({ signal:controller.signal })).toBe(blob);
    expect(state.cover).toHaveBeenCalledWith({ signal:controller.signal });
  });
  it('does not call the engine for an already aborted cover request', async () => {
    const reader = await open(), controller = new AbortController(); controller.abort();
    expect(await reader.getCoverBlob({ signal:controller.signal })).toBeNull();
    expect(state.cover).not.toHaveBeenCalled();
  });
  it('discards a late engine result after the reader session closes', async () => {
    const reader = await open(); let resolve;
    state.cover.mockReturnValue(new Promise(done => { resolve = done; }));
    const request = reader.getCoverBlob(); reader.close(); resolve(new Blob(['obsolete']));
    expect(await request).toBeNull();
  });
});
