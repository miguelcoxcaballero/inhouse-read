package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.lang.ref.WeakReference;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;
import org.json.JSONObject;

/** Only transports neural PCM. It never invokes Android TextToSpeech. */
public final class NativePcmBridge {
    private final WeakReference<Activity> activity;
    private final WeakReference<WebView> web;
    private final ArrayDeque<Runnable> pending = new ArrayDeque<>();
    private volatile boolean closed;
    private volatile String session;
    private NativePcmService service;
    private boolean wantsPlayback;
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
    @JavascriptInterface public void begin(String id, String title) {
        if (id == null || id.length() > 120) return;
        ui(() -> {
            if (id.equals(session) && service != null && wantsPlayback) return;
            pending.clear(); session = id; wantsPlayback = true; service = null;
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
        JSONObject detail = new JSONObject();
        try { detail.put("session", id); detail.put("type", type); detail.put("unit", unit); if (epoch >= 0) detail.put("epoch", epoch); if (reason != null) detail.put("reason", reason); }
        catch (Exception ignored) {}
        Log.i("InhousePcm", detail.toString());
        ui(() -> { WebView view = web.get(); if (id != null && id.equals(session) && view != null) view.evaluateJavascript("window.dispatchEvent(new CustomEvent('inhouse-pcm',{detail:" + detail + "}));", null); });
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
