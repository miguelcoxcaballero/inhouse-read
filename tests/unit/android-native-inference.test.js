import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
const bridge=readFileSync('android/NativeInferenceBridge.java','utf8'),builder=readFileSync('android/html_to_apk_builder.py','utf8')
describe('Android ONNX execution',()=>{
  it('executes inference on one native CPU executor and frees every input and result',()=>{
    expect(bridge).toContain('Executors.newSingleThreadExecutor()')
    expect(bridge).toContain('setIntraOpNumThreads(1)');expect(bridge).toContain('setInterOpNumThreads(1)')
    expect(bridge).toContain('setCPUArenaAllocator(false)');expect(bridge).toContain('setMemoryPatternOptimization(false)')
    expect(bridge).toContain('try (OrtSession.Result result = session.run(inputs))')
    expect(bridge).toContain('finally { for (OnnxTensor input : inputs.values()) input.close(); }')
    expect(bridge).toContain('finally { upload.close(); }')
    for(const forbidden of ['TextToSpeech','resumeTimers','onResume()','postDelayed','WakeLock','setVisibility','setTimer','HttpURLConnection'])expect(bridge).not.toContain(forbidden)
  })
  it('checks production origin on UI and session generation on the executor and callback',()=>{
    expect(bridge).toContain('owner.runOnUiThread(() -> { if (trusted()) action.run(); })')
    expect(bridge).toContain('!owner.equals(token)')
    expect(bridge).toContain('"https".equals(page.getScheme())')
    expect(bridge).toContain('"miguelcoxcaballero.github.io".equals(page.getHost())')
    expect(bridge).toContain('startsWith("/inhouse-read/")')
  })
  it('bounds uploads, dimensions and finite tensors and never builds network requests',()=>{
    for(const guard of ['bytes > 350_000_000','sessions.size() >= 5','offset != upload.bytes','upload.bytes != upload.expected','count > 2_000_000','bytes.length != count * width','Float.isFinite(sample)'])expect(bridge).toContain(guard)
    expect(bridge).toContain('ByteOrder.LITTLE_ENDIAN')
    expect(bridge).toContain('directory = new File(activity.getCacheDir(), "neural-inference")')
  })
  it('registers and closes the bridge in both activity templates with a pinned native library',()=>{
    expect(builder).toContain('"NativeInferenceBridge.java"')
    expect(builder.match(/"InhouseInference"/g)).toHaveLength(2)
    expect(builder).toContain('inferenceBridge.close()');expect(builder).toContain('inferenceBridge?.close()')
    expect(builder).toContain('com.microsoft.onnxruntime:onnxruntime-android:1.22.0')
  })
})
