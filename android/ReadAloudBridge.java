package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Small native speech adapter; all text stays on the device's TTS engine. */
public final class ReadAloudBridge {
    private final Activity activity;
    private final WebView webView;
    private final AudioManager audio;
    private final AudioManager.OnAudioFocusChangeListener focusListener;
    private TextToSpeech engine;
    private boolean ready = false;
    private boolean failed = false;
    private boolean closed = false;
    private Runnable pending;
    private String activeId;
    private volatile String voicesJson = "[]";
    // Set when the user was sent to the engine's voice downloads: the next refreshVoices() rebuilds the engine so new voices show up without restarting the app.
    private boolean voiceInstallOpened = false;

    public ReadAloudBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        audio = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
        focusListener = change -> {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                activity.runOnUiThread(() -> { String id = activeId; stopOnUi(); emit("interrupted", id); });
            }
        };
        startEngine();
    }
    private void startEngine() {
        ready = false; failed = false;
        engine = new TextToSpeech(activity, status -> {
            if (closed) return;
            ready = status == TextToSpeech.SUCCESS;
            failed = !ready;
            if (ready) {
                engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { emit("start", id); }
                    @Override public void onDone(String id) { emit("done", id); }
                    @Override public void onError(String id) { emit("error", id); }
                });
                try {
                    // Tell the engine this is spoken media so volume keys, ducking and routing behave like an audiobook.
                    engine.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                } catch (Exception ignored) {}
                voicesJson = buildVoicesJson();
                emit("voiceschanged", "");
            }
            Runnable next = pending; pending = null;
            if (next != null) next.run();
        });
    }
    /** Every installed voice with the metadata the web catalog ranks by; voiceURI/name/lang stay for older web code. */
    private String buildVoicesJson() {
        JSONArray voices = new JSONArray();
        try {
            Set<Voice> all = engine == null ? null : engine.getVoices();
            if (all != null) for (Voice voice : all) {
                try { voices.put(describe(voice)); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return voices.toString();
    }
    private static JSONObject describe(Voice voice) throws Exception {
        Locale locale = voice.getLocale();
        Set<String> features = voice.getFeatures();
        boolean network = voice.isNetworkConnectionRequired();
        boolean installed = features == null || !features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
        int quality = voice.getQuality();
        String qualityLabel = quality >= Voice.QUALITY_HIGH ? "alta calidad" : quality >= Voice.QUALITY_NORMAL ? "calidad normal" : "calidad básica";
        String where = network ? "requiere internet" : "sin conexión";
        JSONObject item = new JSONObject();
        item.put("voiceURI", voice.getName());
        item.put("name", locale.getDisplayName() + (network ? " · online" : " · dispositivo"));
        item.put("label", locale.getDisplayName() + " · " + qualityLabel + " · " + where);
        item.put("lang", locale.toLanguageTag());
        item.put("quality", quality);
        item.put("latency", voice.getLatency());
        item.put("network", network);
        item.put("installed", installed);
        item.put("features", features == null ? new JSONArray() : new JSONArray(features));
        return item;
    }
    private boolean trusted() {
        Uri page = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        return "https".equals(page.getScheme()) && "miguelcoxcaballero.github.io".equals(page.getHost())
            && (page.getPath() == null ? "" : page.getPath()).startsWith("/inhouse-read/");
    }
    @JavascriptInterface public String getVoices() { return voicesJson; }
    /** Opens the engine's voice-data download screen (best), else the system TTS settings, so the user can install higher-quality offline voices. */
    @JavascriptInterface public void openVoiceSettings() {
        activity.runOnUiThread(() -> {
            if (closed || !trusted()) return;
            String[] actions = { TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA, "com.android.settings.TTS_SETTINGS", Settings.ACTION_SETTINGS };
            for (String action : actions) {
                try { activity.startActivity(new Intent(action)); voiceInstallOpened = true; return; }
                catch (Exception ignored) { /* no activity for this action on this device: try the next one */ }
            }
        });
    }
    /** Re-reads the installed voices (after the user came back from the voice settings) and tells the page. */
    @JavascriptInterface public void refreshVoices() {
        activity.runOnUiThread(() -> {
            if (closed || !trusted()) return;
            if (voiceInstallOpened && activeId == null && pending == null) {
                voiceInstallOpened = false;
                try { if (engine != null) engine.shutdown(); } catch (Exception ignored) {}
                startEngine(); // its init callback republishes the voices
                return;
            }
            voicesJson = buildVoicesJson();
            emit("voiceschanged", "");
        });
    }
    @JavascriptInterface public void speak(String text, String language, double rate, String voiceName, String id) {
        activity.runOnUiThread(() -> {
            if (closed || !trusted() || text == null || id == null) return;
            Runnable speak = () -> {
                if (closed || !trusted()) return;
                if (failed || !ready) { emit("error", id); return; }
                Locale locale = Locale.forLanguageTag(language == null ? "" : language);
                if (locale.getLanguage().isEmpty()) locale = Locale.getDefault();
                int supported = engine.setLanguage(locale);
                if (voiceName != null && !voiceName.isEmpty() && engine.getVoices() != null) {
                    for (Voice voice : engine.getVoices()) if (voiceName.equals(voice.getName())) {
                        supported = engine.setVoice(voice); break;
                    }
                }
                if (supported < 0) { emit("error", id); return; }
                activeId = id;
                audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                engine.setSpeechRate((float) Math.max(.5, Math.min(2, rate)));
                int result = engine.speak(text.substring(0, Math.min(text.length(), 3500)), TextToSpeech.QUEUE_FLUSH, null, id);
                if (result == TextToSpeech.ERROR) emit("error", id);
            };
            if (!ready && !failed) pending = speak; else speak.run();
        });
    }
    @JavascriptInterface public void stop() { activity.runOnUiThread(() -> { if (trusted()) stopOnUi(); }); }
    private void stopOnUi() {
        pending = null; activeId = null;
        if (engine != null) engine.stop();
        audio.abandonAudioFocus(focusListener);
    }
    private void emit(String type, String id) {
        if (closed || id == null) return;
        activity.runOnUiThread(() -> {
            if (closed || !trusted()) return;
            try {
                JSONObject detail = new JSONObject(); detail.put("type", type); detail.put("id", id);
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:" + detail.toString() + "}));", null);
            } catch (Exception ignored) {}
        });
    }
    public void close() { closed = true; stopOnUi(); if (engine != null) engine.shutdown(); }
}
