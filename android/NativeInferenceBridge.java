package __PACKAGE__;

import android.app.Activity;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.ref.WeakReference;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** Same downloaded ONNX models, one CPU executor, bounded tensor transfers. */
public final class NativeInferenceBridge {
    private final WeakReference<Activity> activity;
    private final WeakReference<WebView> web;
    private final File directory;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<Long, Upload> uploads = new HashMap<>();
    private final Map<Long, OrtSession> sessions = new HashMap<>();
    private volatile boolean closed;
    private volatile String token;
    private OrtEnvironment environment;
    private interface Action { void run() throws Exception; }
    private static final class Upload {
        final File file;
        final long expected;
        FileOutputStream output;
        long bytes;
        Exception error;
        Upload(File file, long expected) throws Exception { this.file = file; this.expected = expected; output = new FileOutputStream(file); }
        void close() { try { if (output != null) output.close(); } catch (Exception ignored) {} output = null; file.delete(); }
    }
    public NativeInferenceBridge(Activity activity, WebView web) {
        this.activity = new WeakReference<>(activity); this.web = new WeakReference<>(web);
        directory = new File(activity.getCacheDir(), "neural-inference");
    }
    private boolean trusted() {
        WebView view = web.get();
        Uri page = Uri.parse(view == null || view.getUrl() == null ? "" : view.getUrl());
        return !closed && "https".equals(page.getScheme()) && "miguelcoxcaballero.github.io".equals(page.getHost())
            && (page.getPath() == null ? "" : page.getPath()).startsWith("/inhouse-read/");
    }
    private void ui(Runnable action) {
        Activity owner = activity.get();
        if (owner != null) owner.runOnUiThread(() -> { if (trusted()) action.run(); });
    }
    private void submit(String owner, long id, Action action) {
        ui(() -> executor.execute(() -> {
            if (closed || owner == null || !owner.equals(token)) return;
            try { action.run(); } catch (Exception | LinkageError error) { reply(owner, id, null, "Native inference failed: " + error.getClass().getSimpleName()); }
        }));
    }
    @JavascriptInterface public int getProtocol() { return 1; }
    @JavascriptInterface public void begin(String owner) {
        if (owner == null || owner.length() > 120) return;
        ui(() -> executor.execute(() -> { cleanup(); token = owner; }));
    }
    @JavascriptInterface public void startModel(String owner, long id, long bytes) {
        submit(owner, id, () -> {
            if (id <= 0 || bytes < 1 || bytes > 350_000_000 || uploads.size() >= 1 || sessions.size() >= 5) throw new IllegalArgumentException("Model bounds");
            directory.mkdirs();
            uploads.put(id, new Upload(new File(directory, "model-" + id + ".onnx"), bytes));
        });
    }
    @JavascriptInterface public void modelChunk(String owner, long id, long offset, String encoded) {
        submit(owner, id, () -> {
            Upload upload = uploads.get(id);
            if (upload == null || upload.error != null) return;
            try {
                if (encoded == null || encoded.length() > 180_000 || offset != upload.bytes) throw new IllegalArgumentException("Chunk order");
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (bytes.length < 1 || bytes.length > 131072 || upload.bytes + bytes.length > upload.expected) throw new IllegalArgumentException("Chunk bounds");
                upload.output.write(bytes); upload.bytes += bytes.length;
            } catch (Exception error) { upload.error = error; }
        });
    }
    @JavascriptInterface public void finishModel(String owner, long id) {
        submit(owner, id, () -> {
            Upload upload = uploads.remove(id);
            if (upload == null) throw new IllegalArgumentException("Missing upload");
            try {
                if (upload.error != null) throw upload.error;
                if (upload.bytes != upload.expected) throw new IllegalArgumentException("Incomplete model");
                upload.output.close(); upload.output = null;
                if (environment == null) environment = OrtEnvironment.getEnvironment();
                try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
                    options.setIntraOpNumThreads(1); options.setInterOpNumThreads(1);
                    options.setCPUArenaAllocator(false); options.setMemoryPatternOptimization(false);
                    options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                    OrtSession session = environment.createSession(upload.file.getAbsolutePath(), options);
                    sessions.put(id, session);
                    logInference(id, id, 1);
                    JSONObject result = new JSONObject().put("session", id).put("inputNames", new JSONArray(session.getInputNames())).put("outputNames", new JSONArray(session.getOutputNames()));
                    reply(owner, id, result, null);
                }
            } finally { upload.close(); }
        });
    }
    private OnnxTensor tensor(JSONObject value) throws Exception {
        String type = value.getString("type"), encoded = value.getString("data");
        int width = "float32".equals(type) ? 4 : "int64".equals(type) ? 8 : 0;
        JSONArray shape = value.getJSONArray("dims"); long[] dimensions = new long[shape.length()]; long count = 1;
        if (width == 0 || shape.length() > 8 || encoded.length() > 16_000_000) throw new IllegalArgumentException("Tensor bounds");
        for (int i = 0; i < dimensions.length; i++) {
            dimensions[i] = shape.getLong(i);
            if (dimensions[i] < 0 || dimensions[i] > 2_000_000) throw new IllegalArgumentException("Shape bounds");
            count = Math.multiplyExact(count, dimensions[i]);
            if (count > 2_000_000) throw new IllegalArgumentException("Tensor size");
        }
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length != count * width) throw new IllegalArgumentException("Tensor length");
        ByteBuffer data = ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.LITTLE_ENDIAN); data.put(bytes); data.rewind();
        if (width == 8) return OnnxTensor.createTensor(environment, data.asLongBuffer(), dimensions);
        FloatBuffer floats = data.asFloatBuffer();
        for (int i = 0; i < floats.limit(); i++) if (!Float.isFinite(floats.get(i))) throw new IllegalArgumentException("Tensor samples");
        return OnnxTensor.createTensor(environment, floats, dimensions);
    }
    @JavascriptInterface public void run(String owner, long id, long key, String encoded) {
        if (encoded == null || encoded.length() > 24_000_000) { submit(owner, id, () -> { throw new IllegalArgumentException("Feed bounds"); }); return; }
        submit(owner, id, () -> {
            OrtSession session = sessions.get(key);
            if (session == null) throw new IllegalArgumentException("Missing session");
            JSONObject feeds = new JSONObject(encoded); Map<String, OnnxTensor> inputs = new HashMap<>();
            try {
                if (feeds.length() != session.getInputNames().size()) throw new IllegalArgumentException("Input names");
                for (String name : session.getInputNames()) inputs.put(name, tensor(feeds.getJSONObject(name)));
                try (OrtSession.Result result = session.run(inputs)) {
                    JSONObject outputs = new JSONObject();
                    for (Map.Entry<String, OnnxValue> entry : result) {
                        if (!(entry.getValue() instanceof OnnxTensor)) throw new IllegalArgumentException("Output tensor");
                        OnnxTensor tensor = (OnnxTensor) entry.getValue(); TensorInfo info = tensor.getInfo();
                        FloatBuffer samples = tensor.getFloatBuffer();
                        if (samples == null || samples.remaining() > 2_000_000) throw new IllegalArgumentException("Output bounds");
                        ByteBuffer data = ByteBuffer.allocate(samples.remaining() * 4).order(ByteOrder.LITTLE_ENDIAN);
                        while (samples.hasRemaining()) { float sample = samples.get(); if (!Float.isFinite(sample)) throw new IllegalArgumentException("Output samples"); data.putFloat(sample); }
                        outputs.put(entry.getKey(), new JSONObject().put("type", "float32").put("dims", new JSONArray(info.getShape())).put("data", Base64.encodeToString(data.array(), Base64.NO_WRAP)));
                    }
                    reply(owner, id, outputs, null);
                    logInference(id, key, 2);
                }
            } finally { for (OnnxTensor input : inputs.values()) input.close(); }
        });
    }
    @JavascriptInterface public void release(String owner, long id, long key) {
        submit(owner, id, () -> { OrtSession session = sessions.remove(key); if (session != null) session.close(); reply(owner, id, JSONObject.NULL, null); });
    }
    private void logInference(long request, long model, int phase) {
        try {
            Log.i("InhouseInference", new JSONObject().put("schema", 1).put("nativeId", token)
                .put("request", request).put("model", model).put("phase", phase)
                .put("elapsedMs", SystemClock.elapsedRealtime()).toString());
        } catch (Exception ignored) {}
    }
    private void reply(String owner, long id, Object result, String error) {
        ui(() -> {
            if (!owner.equals(token)) return;
            try {
                JSONObject detail = new JSONObject().put("token", owner).put("id", id);
                if (error != null) detail.put("error", error); else detail.put("value", result);
                WebView view = web.get();
                if (view != null) view.evaluateJavascript("window.dispatchEvent(new CustomEvent('inhouse-inference',{detail:" + detail + "}));", null);
            } catch (Exception ignored) {}
        });
    }
    private void cleanup() {
        for (Upload upload : uploads.values()) upload.close(); uploads.clear();
        for (OrtSession session : sessions.values()) try { session.close(); } catch (Exception ignored) {}
        sessions.clear(); token = null;
    }
    @JavascriptInterface public void dispose(String owner) { submit(owner, 0, () -> cleanup()); }
    public void close() { closed = true; executor.execute(() -> cleanup()); executor.shutdown(); }
}
