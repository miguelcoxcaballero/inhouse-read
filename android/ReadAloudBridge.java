package __PACKAGE__;

import android.app.Activity;
import android.media.AudioManager;
import android.net.Uri;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.Locale;
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

    public ReadAloudBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        audio = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
        focusListener = change -> {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                activity.runOnUiThread(() -> { String id = activeId; stopOnUi(); emit("interrupted", id); });
            }
        };
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
                JSONArray voices = new JSONArray();
                if (engine.getVoices() != null) for (Voice voice : engine.getVoices()) {
                    try {
                        JSONObject item = new JSONObject();
                        item.put("voiceURI", voice.getName());
                        item.put("name", voice.getLocale().getDisplayName() + (voice.isNetworkConnectionRequired() ? " · online" : " · dispositivo"));
                        item.put("lang", voice.getLocale().toLanguageTag());
                        voices.put(item);
                    } catch (Exception ignored) {}
                }
                voicesJson = voices.toString();
                emit("voiceschanged", "");
            }
            Runnable next = pending; pending = null;
            if (next != null) next.run();
        });
    }
    private boolean trusted() {
        Uri page = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        return "https".equals(page.getScheme()) && "miguelcoxcaballero.github.io".equals(page.getHost())
            && (page.getPath() == null ? "" : page.getPath()).startsWith("/inhouse-read/");
    }
    @JavascriptInterface public String getVoices() { return voicesJson; }
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
