// Test harness: the voice module with some of its exports replaced. The synthesis worker and the Android client reach the
// Hebrew phonemizer and the Supertonic runtime as exports of the voice module (voice_hebrew_create,
// voice_supertonic_create); a test that stands in for one of them mocks src/js/rust-voice-ui.js with this:
//   vi.mock('../../src/js/rust-voice-ui.js', async original => (await import('./helpers/voice-kernel-fakes.js')).withKernels(await original(), fakes))
export function withKernels(real, fakes) {
  let from = null, patched = null
  const wrap = voice => voice && (from === voice ? patched : (from = voice, patched = { ...voice, ...fakes }))
  return { ...real, getRustVoiceUI: () => wrap(real.getRustVoiceUI()), loadedRustVoiceUI: () => wrap(real.loadedRustVoiceUI()),
    requireRustVoiceUI: async () => wrap(await real.requireRustVoiceUI()), loadRustVoiceUI: async options => wrap(await real.loadRustVoiceUI(options)) }
}
