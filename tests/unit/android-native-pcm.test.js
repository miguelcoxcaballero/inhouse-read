import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read=path=>readFileSync(path,'utf8').replace(/\r\n?/g,'\n')
const bridge=read('android/NativePcmBridge.java'),service=read('android/NativePcmService.java'),builder=read('android/html_to_apk_builder.py'),workflow=read('.github/workflows/build-android.yml')
describe('signed Android native natural media integration',()=>{
  it('logs bounded navigation stages without touching playback or evaluating JS',()=>{
    const report=bridge.slice(bridge.indexOf('@JavascriptInterface public void reportNavigationStage'),bridge.indexOf('private void logRuntime'));
    expect(report).toContain('turnStage > 3');expect(report).toContain('displayStage > 6');expect(report).toContain('viewReady > 3');
    expect(report).toContain('session == null || !wantsPlayback');expect(report).toContain('Log.i("InhouseBookLoad"');
    for(const forbidden of ['evaluateJavascript','postDelayed','enqueue(','reset(','keepExecuting(','resumeTimers'])expect(report).not.toContain(forbidden);
  })
  it('allows numeric paginator stages in the existing receipt without new playback evaluations',()=>{
    const sanitizer=bridge.slice(bridge.indexOf('private static JSONObject sanitizeSnapshot'),bridge.indexOf('private void logCallback'));
    for(const field of ['paginator','turnStage','displayStage','sectionLoadPending','viewLoadPending','viewReady'])expect(sanitizer).toContain(`"${field}"`);
    for(const forbidden of ['evaluateJavascript','postDelayed','setTimeout','enqueue(','keepExecuting('])expect(sanitizer).not.toContain(forbidden);
  })
  it('observes post-event microtasks with two bounded numeric receipts and no scheduler heartbeat',()=>{
    expect(bridge).toContain('ticks===8||ticks===32');expect(bridge).toContain('if(ticks<32)observe()');
    const report=bridge.slice(bridge.indexOf('@JavascriptInterface public void reportDiagnostic'),bridge.indexOf('private void logRuntime'));
    expect(report).toContain('microtask != 8 && microtask != 32');
    expect(report).toContain('!id.equals(session)');expect(report).toContain('serial > diagnosticSerial');
    expect(report).toContain('sanitizeSnapshot(new JSONObject(encoded), 0)');
    for(const forbidden of ['evaluateJavascript','postDelayed','setTimeout','enqueue(','reset(','keepExecuting('])expect(report).not.toContain(forbidden);
  })
  it('ships an unexported mediaPlayback service and only the necessary native playback permissions',()=>{
    for(const permission of ['WAKE_LOCK','FOREGROUND_SERVICE','FOREGROUND_SERVICE_MEDIA_PLAYBACK'])expect(builder).toContain(`android.permission.${permission}`)
    expect(builder).toContain('service.set(f"{ns}exported", "false")')
    expect(builder).toContain('service.set(f"{ns}foregroundServiceType", "mediaPlayback")')
    expect(workflow).toContain('verify_android_background.py inhouse-read-release-v1.1.7.apk')
    expect(workflow).toContain('[skip ci]')
  })
  it('registers/removes the PCM bridge in both Java and Kotlin and resumes only active playback after Activity pause',()=>{
    const kotlin=builder.indexOf('f"""package {package_id}\n')
    for(const template of [builder.slice(0,kotlin),builder.slice(kotlin)]){
      expect(template).toContain('"InhousePcm"');expect(template).toContain('pcmBridge');expect(template).toContain('onActivityPaused()');expect(template).toContain('pcmBridge')
    }
    expect(bridge).toContain('if (service != null && service.isPlaying()) keepExecuting()')
    expect(bridge).toContain('view.onResume(); view.resumeTimers()')
    expect(bridge).toContain('WebView.RENDERER_PRIORITY_IMPORTANT, false')
    expect(builder).toContain('pcmBridge.close()');expect(builder).toContain('pcmBridge?.close()')
  })
  it('validates origin only on the UI thread and transports finite little-endian Float32 PCM',()=>{
    expect(bridge).toContain('owner.runOnUiThread(() -> { if (trusted()) task.run(); })')
    const protocol=bridge.slice(bridge.indexOf('@JavascriptInterface public int getProtocol'),bridge.indexOf('@JavascriptInterface public void begin'))
    expect(protocol).not.toContain('getUrl()')
    expect(bridge).toContain('ByteOrder.LITTLE_ENDIAN');expect(bridge).toContain('Float.isNaN(sample) || Float.isInfinite(sample)')
    expect(service).toContain('AudioFormat.ENCODING_PCM_FLOAT');expect(service).toContain('AudioTrack.WRITE_NON_BLOCKING')
    expect(service).not.toContain('TextToSpeech')
  })
  it('rejects stale notification sessions without stopping a valid newer one',()=>{
    const controls=service.slice(service.indexOf('if (STOP.equals(action) || PAUSE.equals(action)'),service.indexOf('if (!next.equals(session))'))
    expect(controls).toContain('if (next == null || !next.equals(session)) return START_NOT_STICKY;')
    expect(controls).toContain('if (!owner.hasLiveSession()) { stopPlayback(false);')
    expect(controls).toContain('if (!owner.hasSession(next)) return START_NOT_STICKY;')
    expect(controls).toContain('if (next == null || !owner.hasSession(next)) return START_NOT_STICKY;')
    expect(service).toContain('onPause() { if (currentOwner()) pausePlayback(true); }')
    expect(service).toContain('onStop() { if (currentOwner()) stopPlayback(true); }')
    expect(service).toContain('return owner.hasSession(session);')
    expect(bridge).toContain('wantsPlayback = false; pending.clear()')
    expect(bridge).toContain('if (!wantsPlayback) { next.pausePlayback(false); pending.clear(); return; }')
  })
  it('guards late focus loss and PCM callbacks by the actual session/epoch',()=>{
    expect(service).toContain('focusToken == focusGeneration && focusSession.equals(session)')
    expect(service).toContain('focusGeneration++; playback.removeCallbacks(pump)')
    expect(service).toContain('epoch != expectedEpoch')
    expect(service).toContain('owner.emit(currentSession, epoch, "start"')
    expect(service).toContain('failedSession.equals(session) && failedEpoch == epoch')
  })
  it('bounds CPU polling, extends the 32-bit AudioTrack head, and releases wake/focus on Pause/Stop',()=>{
    expect(service).toContain('units.isEmpty() ? 200 : 20')
    expect(service).toContain('elapsedRealtime() - lastStatePublish >= 50')
    expect(service).toContain('headWrap += 1L << 32')
    expect(service).toContain('lastHead = headWrap = 0')
    expect(service).toContain('if (wake.isHeld()) wake.release()');expect(service).toContain('audio.abandonAudioFocusRequest(focus)')
    for(const method of ['void pausePlayback','void stopPlayback'])expect(service.slice(service.indexOf(method),service.indexOf(method)+300)).toContain('releaseActive()')
  })
})
