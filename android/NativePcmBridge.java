package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.lang.ref.WeakReference;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Only transports neural PCM. It never invokes Android TextToSpeech. */
public final class NativePcmBridge {
    private final WeakReference<Activity> activity;
    private final WeakReference<WebView> web;
    private final ArrayDeque<Runnable> pending = new ArrayDeque<>();
    private volatile boolean closed;
    private volatile String session;
    private NativePcmService service;
    private boolean wantsPlayback;
    private long diagnosticSerial;
    private long navigationSerial;
    public NativePcmBridge(Activity activity, WebView web) {
        this.activity = new WeakReference<>(activity); this.web = new WeakReference<>(web);
    }
    private boolean trusted() {
        WebView view = web.get();
        Uri page = Uri.parse(view == null || view.getUrl() == null ? "" : view.getUrl());
        return !closed && "https".equals(page.getScheme()) && "miguelcoxcaballero.github.io".equals(page.getHost())
            && (page.getPath() == null ? "" : page.getPath()).startsWith("/inhouse-read/");
    }
    private void ui(Runnable task) {
        Activity owner = activity.get();
        if (owner != null) owner.runOnUiThread(() -> { if (trusted()) task.run(); });
    }
    // JavascriptInterface runs on a bridge thread. Do not read WebView here.
    @JavascriptInterface public int getProtocol() { return Build.VERSION.SDK_INT >= 26 ? 1 : 0; }
    @JavascriptInterface public String getState() { return NativePcmService.state; }
    // Passive numeric synthesis receipts on the bridge thread. Do not read
    // WebView, post another evaluation, wake the display or alter the service.
    @JavascriptInterface public void reportSynthesisStage(String id, int domain, int stage, long request, int part) {
        if (closed || id == null || !id.equals(session) || domain < 1 || domain > 3 || stage < 1 || stage > 7 || request < 0 || part < 0 || part > 100000) return;
        JSONObject value = new JSONObject();
        try { value.put("schema", 1); value.put("session", id); value.put("elapsedMs", SystemClock.elapsedRealtime()); value.put("domain", domain); value.put("stage", stage); value.put("request", request); value.put("part", part); }
        catch (Exception ignored) { return; }
        Log.i("InhouseSynthesis", value.toString());
    }
    @JavascriptInterface public void begin(String id, String title) {
        if (id == null || id.length() > 120) return;
        ui(() -> {
            if (id.equals(session) && service != null && wantsPlayback) return;
            pending.clear(); session = id; wantsPlayback = true; service = null;
            logRuntime(id);
            Activity owner = activity.get();
            try {
                NativePcmService.owner = this;
                Intent intent = new Intent(owner, NativePcmService.class).setAction(NativePcmService.PLAY)
                    .putExtra("session", id).putExtra("title", title == null ? "Audiolibro" : title.substring(0, Math.min(200, title.length())));
                owner.startForegroundService(intent);
                keepExecuting();
            } catch (Exception error) { emit(id, "error", -1, "native-start-failed"); }
        });
    }
    private void command(String id, Runnable action) {
        ui(() -> {
            if (id == null || !id.equals(session) || !wantsPlayback) return;
            if (service == null) {
                if (pending.size() >= 32) { emit(id, "error", -1, "native-queue-full"); return; }
                pending.add(action);
            } else action.run();
        });
    }
    @JavascriptInterface public void enqueue(String id, long epoch, long unit, String encoded, int rate, boolean last) {
        if (unit < 0 || rate < 8000 || rate > 96000 || encoded == null || encoded.length() > 4_000_000) { ui(() -> emit(id, "error", unit, "invalid-pcm")); return; }
        final float[] pcm;
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length % 4 != 0) throw new IllegalArgumentException("PCM length");
            pcm = new float[bytes.length / 4];
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(pcm);
            for (float sample : pcm) if (Float.isNaN(sample) || Float.isInfinite(sample)) throw new IllegalArgumentException("PCM sample");
        } catch (Exception error) { ui(() -> emit(id, "error", unit, "invalid-pcm")); return; }
        command(id, () -> service.enqueue(id, epoch, unit, pcm, rate, last));
    }
    @JavascriptInterface public void reset(String id, long epoch) { command(id, () -> service.reset(id, epoch)); }
    @JavascriptInterface public void truncateAfter(String id, long epoch, long unit) { command(id, () -> service.truncate(id, epoch, unit)); }
    @JavascriptInterface public void pause(String id) {
        ui(() -> { if (id != null && id.equals(session)) { wantsPlayback = false; pending.clear(); if (service != null) service.pausePlayback(false); } });
    }
    @JavascriptInterface public void stop(String id) {
        ui(() -> { if (id != null && id.equals(session)) stopOnUi(); });
    }
    @JavascriptInterface public void mark(String id, String utterance, int chapter, String kind) {
        if (utterance == null || utterance.length() > 120 || chapter < 0 || chapter > 100000 || !("chapter".equals(kind) || "page".equals(kind))) return;
        ui(() -> {
            if (!hasSession(id) || !wantsPlayback) return;
            JSONObject detail = new JSONObject();
            try { detail.put("session", id); detail.put("utterance", utterance); detail.put("chapter", chapter); detail.put("kind", kind); detail.put("interactive", ((PowerManager) activity.get().getSystemService(Activity.POWER_SERVICE)).isInteractive()); }
            catch (Exception ignored) {}
            Log.i("InhousePcmProgress", detail.toString());
        });
    }
    void attach(NativePcmService next, String id) {
        if (closed || !id.equals(session) || !trusted()) { next.stopPlayback(false); return; }
        service = next;
        if (!wantsPlayback) { next.pausePlayback(false); pending.clear(); return; }
        keepExecuting();
        while (!pending.isEmpty()) pending.remove().run();
    }
    void detach(NativePcmService previous) { if (service == previous) service = null; }
    boolean hasSession(String id) { return id != null && id.equals(session) && trusted(); }
    boolean hasLiveSession() { return session != null && trusted(); }
    void keepExecuting() {
        WebView view = web.get();
        if (view != null && trusted()) {
            view.onResume(); view.resumeTimers();
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
    public void onActivityPaused() { if (service != null && service.isPlaying()) keepExecuting(); }
    void control(String id, String action) {
        ui(() -> {
            if (!id.equals(session)) return;
            JSONObject detail = new JSONObject();
            try { detail.put("session", id); detail.put("action", action); } catch (Exception ignored) {}
            WebView view = web.get();
            if (view != null) view.evaluateJavascript("window.dispatchEvent(new CustomEvent('inhouse-audio-control',{detail:" + detail + "}));", null);
        });
    }
    void emit(String id, String type, long unit, String reason) {
        emit(id, -1, type, unit, reason);
    }
    void emit(String id, long epoch, String type, long unit, String reason) {
        emit(id, epoch, type, unit, reason, false);
    }
    void emit(String id, long epoch, String type, long unit, String reason, boolean queueEmpty) {
        JSONObject detail = new JSONObject();
        try { detail.put("session", id); detail.put("type", type); detail.put("unit", unit); if (epoch >= 0) detail.put("epoch", epoch); if (reason != null) detail.put("reason", reason); }
        catch (Exception ignored) {}
        Log.i("InhousePcm", detail.toString());
        ui(() -> {
            WebView view = web.get();
            if (id == null || !id.equals(session) || view == null) return;
            // Attach the receipt to the event evaluation already required by
            // playback. Never poll JS or issue an extra empty-queue evaluation.
            long serial = ++diagnosticSerial, requested = SystemClock.elapsedRealtime();
            logCallback(id, epoch, type, unit, serial, requested, queueEmpty, "requested", null);
            String snapshot = queueEmpty
                ? "typeof window.InhouseReadAudioDiagnostics==='function'?window.InhouseReadAudioDiagnostics(" + JSONObject.quote(id) + "):null"
                : "null";
            String code = "(()=>{window.dispatchEvent(new CustomEvent('inhouse-pcm',{detail:" + detail + "}));"
                + "let snapshot=null;try{snapshot=" + snapshot + ";}catch{}"
                + (queueEmpty ? "let ticks=0;const observe=()=>{queueMicrotask(()=>{ticks++;"
                    + "if(ticks===8||ticks===32){try{window.InhousePcm.reportDiagnostic(" + JSONObject.quote(id) + "," + epoch + "," + unit + "," + serial + ",ticks,JSON.stringify(" + snapshot + "));}catch{}}"
                    + "if(ticks<32)observe();});};observe();" : "")
                + "return JSON.stringify({received:true,hidden:document.hidden,visibility:document.visibilityState,snapshot});})()";
            view.evaluateJavascript(code, value -> logCallback(id, epoch, type, unit, serial, requested, queueEmpty, "received", value));
        });
    }
    // Two bounded numeric observations after the already-required playback
    // event. No polling, timer, extra evaluation, text or progress mutation.
    @JavascriptInterface public void reportDiagnostic(String id, long epoch, long unit, long serial, int microtask, String encoded) {
        if (encoded == null || encoded.length() > 8192 || (microtask != 8 && microtask != 32)) return;
        ui(() -> {
            if (id == null || !id.equals(session) || serial <= 0 || serial > diagnosticSerial) return;
            JSONObject value = new JSONObject();
            try {
                value.put("schema", 1); value.put("session", id); value.put("epoch", epoch);
                value.put("unit", unit); value.put("serial", serial); value.put("microtask", microtask);
                value.put("elapsedMs", SystemClock.elapsedRealtime());
                value.put("snapshot", sanitizeSnapshot(new JSONObject(encoded), 0));
                Log.i("InhousePcmAfterEvent", value.toString());
            } catch (Exception ignored) {}
        });
    }
    // Passive stage receipts: no JS evaluations or playback commands.
    @JavascriptInterface public void reportNavigationStage(int turnStage, int displayStage, boolean sectionPending, boolean viewPending, int viewReady) {
        if (turnStage < 0 || turnStage > 3 || displayStage < 0 || displayStage > 6 || viewReady < 0 || viewReady > 3) return;
        ui(() -> {
            if (session == null || !wantsPlayback) return;
            JSONObject value = new JSONObject();
            try {
                value.put("schema", 1); value.put("session", session);
                value.put("sequence", ++navigationSerial); value.put("elapsedMs", SystemClock.elapsedRealtime());
                value.put("turnStage", turnStage); value.put("displayStage", displayStage);
                value.put("sectionLoadPending", sectionPending); value.put("viewLoadPending", viewPending); value.put("viewReady", viewReady);
                Log.i("InhouseBookLoad", value.toString());
            } catch (Exception ignored) {}
        });
    }
    private void logRuntime(String id) {
        JSONObject value = new JSONObject();
        try {
            value.put("schema", 1); value.put("session", id);
            value.put("elapsedMs", SystemClock.elapsedRealtime()); value.put("androidSdk", Build.VERSION.SDK_INT);
            PackageInfo info = Build.VERSION.SDK_INT >= 26 ? WebView.getCurrentWebViewPackage() : null;
            if (info != null) { value.put("webViewPackage", info.packageName); value.put("webViewVersion", info.versionName); }
        } catch (Exception ignored) {}
        Log.i("InhousePcmRuntime", value.toString());
    }
    private static JSONObject sanitizeSnapshot(JSONObject raw, int depth) {
        JSONObject value = new JSONObject();
        if (raw == null || depth > 3) return value;
        String[] keys = { "schema", "sessionMatches", "nativeSessionMatches", "hidden", "visibility", "state", "generation", "utteranceSequence", "utterancePresent", "utteranceStarted", "index", "chunkCount", "itemCount", "ttsStarts", "ttsDones", "advanceStage", "preparingPage", "deferredPage", "aheadPage", "reader", "kind", "followPending", "pageTurnPending", "paginator", "turnStage", "displayStage", "sectionLoadPending", "viewLoadPending", "viewReady", "engine", "loaded", "moduleLoading", "queuedRequests", "status", "run", "job", "prepared", "workerAlive", "currentUnit", "entryCount", "queued", "synth", "done", "started", "ended", "deferred", "gateOpen", "buffered", "scheduledChunks", "availableChunks", "timers", "pump", "feed", "hold", "idle" };
        for (String key : keys) {
            Object item = raw.opt(key);
            try {
                if (item instanceof Boolean) value.put(key, item);
                else if (item instanceof Number && !Double.isNaN(((Number) item).doubleValue()) && !Double.isInfinite(((Number) item).doubleValue())) value.put(key, item);
                else if (item instanceof JSONObject) value.put(key, sanitizeSnapshot((JSONObject) item, depth + 1));
                else if (item == JSONObject.NULL && ("index".equals(key) || "currentUnit".equals(key) || "engine".equals(key))) value.put(key, JSONObject.NULL);
                else if (item instanceof String) {
                    String word = (String) item;
                    if (("visibility".equals(key) && ("hidden".equals(word) || "visible".equals(word) || "prerender".equals(word) || "unknown".equals(word)))
                        || ("kind".equals(key) && ("pdf".equals(word) || "foliate".equals(word) || "none".equals(word)))
                        || ("advanceStage".equals(key) && ("idle".equals(word) || "prepare-next".equals(word) || "next-turn".equals(word) || "retry-wait".equals(word) || "retry-turn".equals(word) || "prepare-source".equals(word)))
                        || (("state".equals(key) || "status".equals(key) || "prepared".equals(key)) && ("stopped".equals(word) || "paused".equals(word) || "playing".equals(word) || "loading".equals(word) || "buffering".equals(word) || "speaking".equals(word) || "idle".equals(word) || "none".equals(word) || "pending".equals(word) || "ready".equals(word)))) value.put(key, word);
                }
            } catch (Exception ignored) {}
        }
        return value;
    }
    private void logCallback(String id, long epoch, String type, long unit, long serial, long requested, boolean queueEmpty, String phase, String reply) {
        JSONObject value = new JSONObject();
        try {
            value.put("schema", 1); value.put("session", id); value.put("epoch", epoch);
            value.put("type", type); value.put("unit", unit); value.put("serial", serial);
            value.put("phase", phase); value.put("queueEmpty", queueEmpty);
            value.put("requestedElapsedMs", requested); value.put("elapsedMs", SystemClock.elapsedRealtime());
            value.put("sessionCurrent", !closed && id != null && id.equals(session));
            if (reply != null && reply.length() <= 8192) {
                Object decoded = new JSONTokener(reply).nextValue();
                JSONObject answer = decoded instanceof String ? new JSONObject((String) decoded) : decoded instanceof JSONObject ? (JSONObject) decoded : null;
                if (answer != null) {
                    value.put("received", answer.optBoolean("received", false));
                    if (answer.opt("hidden") instanceof Boolean) value.put("hidden", answer.optBoolean("hidden"));
                    String visibility = answer.optString("visibility", "");
                    if ("hidden".equals(visibility) || "visible".equals(visibility) || "prerender".equals(visibility) || "unknown".equals(visibility)) value.put("visibility", visibility);
                    if (queueEmpty && answer.opt("snapshot") instanceof JSONObject) value.put("snapshot", sanitizeSnapshot(answer.optJSONObject("snapshot"), 0));
                } else value.put("emptyReply", true);
            }
        } catch (Exception ignored) { try { value.put("invalidReply", true); } catch (Exception ignoredAgain) {} }
        Log.i("InhousePcmCallback", value.toString());
    }
    private void stopOnUi() {
        wantsPlayback = false; pending.clear();
        if (service != null) service.stopPlayback(false);
        session = null;
    }
    public void close() {
        stopOnUi(); closed = true;
        if (NativePcmService.owner == this) NativePcmService.owner = null;
    }
}
