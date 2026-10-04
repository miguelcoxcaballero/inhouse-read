import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const service = readFileSync('android/NativePcmService.java', 'utf8').replace(/\r\n?/g, '\n')
const builder = readFileSync('android/html_to_apk_builder.py', 'utf8').replace(/\r\n?/g, '\n')

describe('Android system audiobook controls', () => {
  it('publishes title, playback state and active session before the first foreground notification', () => {
    const activate = service.slice(service.indexOf('private boolean activate()'), service.indexOf('private static AudioAttributes'))
    for (const statement of ['media.setMetadata(', 'updateMedia(true)', 'media.setActive(true)']) {
      expect(activate.indexOf(statement)).toBeGreaterThanOrEqual(0)
      expect(activate.indexOf(statement)).toBeLessThan(activate.indexOf('startForeground('))
    }
    expect(activate).toContain('MediaMetadata.METADATA_KEY_TITLE, title')
    expect(activate).toContain('MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title')
  })

  it('connects the local speech route and the real Activity to the media session', () => {
    expect(service).toContain('media.setPlaybackToLocal(attributes())')
    expect(service).toContain('media.setSessionActivity(launchActivity())')
    expect(service).toContain('.setContentIntent(launchActivity())')
    expect(service).toContain('AudioAttributes.CONTENT_TYPE_SPEECH')
  })

  it('offers a session Stop action for modern Android and validates its current owner', () => {
    expect(service).toContain('.addCustomAction(new PlaybackState.CustomAction.Builder(STOP, "Detener",')
    const callback = service.slice(service.indexOf('onCustomAction('), service.indexOf('private boolean currentOwner()'))
    expect(callback).toContain('STOP.equals(action) && currentOwner()')
    expect(callback).toContain('stopPlayback(true)')
    expect(service).toContain('.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", action(STOP, 2))')
  })

  for (const [name, marker, guard] of [
    ['Java', 'private void applyReadingDisplay()', 'appliedReadingDisplay == null || appliedReadingDisplay != active'],
    ['Kotlin', 'private fun applyReadingDisplay()', 'appliedReadingDisplay != active'],
  ]) {
    it(`${name}: changes system bar visibility only on a reading/lifecycle transition`, () => {
      const begin = builder.indexOf(marker)
      const policy = builder.slice(begin, builder.indexOf('// Vote for the panel', begin))
      const guardAt = policy.indexOf(guard)
      expect(guardAt).toBeGreaterThan(0)
      expect(policy.indexOf('controller.hide(')).toBeGreaterThan(guardAt)
      expect(policy.indexOf('controller.show(')).toBeGreaterThan(guardAt)
      expect(policy).toContain('appliedReadingDisplay = active')
      expect(policy).toContain('FLAG_KEEP_SCREEN_ON')
      expect(policy).toContain('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE')
      expect(policy).toContain('requestApplyInsets')
    })
  }
})
