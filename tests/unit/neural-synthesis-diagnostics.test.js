import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
describe('native synthesis receipts',()=>{
  it('logs bounded numeric stages without posting, evaluating or changing playback',()=>{
    const code=readFileSync('android/NativePcmBridge.java','utf8')
    const method=code.slice(code.indexOf('@JavascriptInterface public void reportSynthesisStage'),code.indexOf('@JavascriptInterface public void begin'))
    expect(method).toContain('!id.equals(session)');expect(method).toContain('domain < 1 || domain > 3');expect(method).toContain('stage < 1 || stage > 7')
    expect(method).toContain('Log.i("InhouseSynthesis"');expect(method).toContain('SystemClock.elapsedRealtime()')
    for(const forbidden of ['ui(','.post(', 'evaluateJavascript','keepExecuting','enqueue(', 'wake.', 'startForegroundService'])expect(method).not.toContain(forbidden)
    const verifier=readFileSync('.github/scripts/verify_android_background.py','utf8');expect(verifier).toContain('"InhouseSynthesis:I"')
  })
})
