package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Build;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import java.util.ArrayList;
import org.json.JSONObject;

/** AudioTrack consumes neural Float32 PCM independently of Web Audio/JS timers. */
public final class NativePcmService extends Service {
    static final String PLAY = "__PACKAGE__.pcm.PLAY", PAUSE = "__PACKAGE__.pcm.PAUSE", STOP = "__PACKAGE__.pcm.STOP";
    static volatile NativePcmBridge owner;
    static volatile String state = "{}";
    private static final String CHANNEL = "natural-audiobook";
    private static final int NOTIFICATION = 7114;
    private final Handler main = new Handler(android.os.Looper.getMainLooper());
    private HandlerThread thread;
    private Handler playback;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private long focusGeneration;
    private PowerManager.WakeLock wake;
    private MediaSession media;
    private volatile boolean active;
    private volatile String session = "";
    private String title = "Audiolibro";
    // Everything below is touched only on the playback HandlerThread.
    private AudioTrack track;
    private int rate;
    private long headBase, written, queued, played, lastHead, headWrap;
    private long lastStateLog, lastStatePublish;
    private volatile long epoch;
    private final ArrayList<Unit> units = new ArrayList<>();
    private static final class Chunk {
        final float[] pcm; final long start; int offset;
        Chunk(float[] pcm, long start) { this.pcm = pcm; this.start = start; }
    }
    private static final class Unit {
        final long id, start; long end; boolean complete, started;
        final ArrayList<Chunk> chunks = new ArrayList<>();
        Unit(long id, long start) { this.id = id; this.start = start; }
    }
    @Override public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("InhouseNeuralPcm", Process.THREAD_PRIORITY_AUDIO); thread.start();
        playback = new Handler(thread.getLooper());
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "InhouseRead:Audiobook");
        wake.setReferenceCounted(false);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Audiolibro natural", NotificationManager.IMPORTANCE_LOW));
        media = new MediaSession(this, "InhouseReadNatural");
        media.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resumeControl(); }
            @Override public void onPause() { if (currentOwner()) pausePlayback(true); }
            @Override public void onStop() { if (currentOwner()) stopPlayback(true); }
        });
    }
    private boolean currentOwner() {
        if (owner == null || !owner.hasLiveSession()) { stopPlayback(false); return false; }
        return owner.hasSession(session);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || owner == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        String next = intent.getStringExtra("session");
        if (STOP.equals(action) || PAUSE.equals(action) || intent.getBooleanExtra("control", false)) {
            if (next == null || !next.equals(session)) return START_NOT_STICKY;
            if (!owner.hasLiveSession()) { stopPlayback(false); return START_NOT_STICKY; }
            if (!owner.hasSession(next)) return START_NOT_STICKY;
            if (STOP.equals(action)) stopPlayback(true);
            else if (PAUSE.equals(action)) pausePlayback(true);
            else resumeControl();
            return START_NOT_STICKY;
        }
        if (!owner.hasLiveSession()) { stopPlayback(false); return START_NOT_STICKY; }
        if (next == null || !owner.hasSession(next)) return START_NOT_STICKY;
        if (!next.equals(session)) {
            // Queue this before bridge.attach flushes any new PCM commands.
            playback.removeCallbacks(pump);
            playback.post(() -> resetTrack(true));
            session = next;
        }
        String label = intent.getStringExtra("title"); if (label != null) title = label;
        if (activate()) owner.attach(this, session);
        return START_NOT_STICKY;
    }
    private boolean activate() {
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification(true), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION, notification(true));
        active = true; if (!wake.isHeld()) wake.acquire();
        media.setActive(true); updateMedia(true);
        if (focus != null) audio.abandonAudioFocusRequest(focus);
        final long focusToken = ++focusGeneration;
        final String focusSession = session;
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes()).setOnAudioFocusChangeListener(change -> {
                if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) main.post(() -> {
                    if (focusToken == focusGeneration && focusSession.equals(session)) pausePlayback(true);
                });
            }).build();
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { if (owner != null) owner.emit(session, "error", -1, "audio-focus-denied"); stopPlayback(false); return false; }
        if (owner != null) owner.keepExecuting();
        playback.removeCallbacks(pump); playback.post(pump);
        return true;
    }
    private static AudioAttributes attributes() { return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(); }
    private Notification notification(boolean playing) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent content = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title)
            .setContentText(playing ? "Voz natural · Reproduciendo" : "Voz natural · En pausa")
            .setContentIntent(content).setOnlyAlertOnce(true).setOngoing(playing)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pausar" : "Continuar", action(playing ? PAUSE : PLAY, 1))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", action(STOP, 2))
            .setStyle(new Notification.MediaStyle().setMediaSession(media.getSessionToken()).setShowActionsInCompactView(0, 1)).build();
    }
    private PendingIntent action(String action, int request) {
        Intent intent = new Intent(this, NativePcmService.class).setAction(action).putExtra("session", session).putExtra("control", true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PLAY.equals(action) ? PendingIntent.getForegroundService(this, request, intent, flags) : PendingIntent.getService(this, request, intent, flags);
    }
    private void updateMedia(boolean playing) {
        media.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP | PlaybackState.ACTION_PLAY_PAUSE)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, 0, playing ? 1 : 0).build());
    }
    private void resumeControl() {
        if (owner == null || !owner.hasLiveSession()) { stopPlayback(false); return; }
        if (!owner.hasSession(session)) return;
        if (active || activate()) owner.control(session, "play");
    }
    boolean isPlaying() { return active; }
    private void releaseActive() {
        active = false; focusGeneration++; playback.removeCallbacks(pump); if (wake.isHeld()) wake.release();
        if (focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; }
    }
    void pausePlayback(boolean control) {
        if (control && owner != null) owner.control(session, "pause");
        releaseActive(); playback.post(() -> resetTrack(true)); updateMedia(false);
        stopForeground(STOP_FOREGROUND_DETACH);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION, notification(false));
    }
    void stopPlayback(boolean control) {
        if (control && owner != null) owner.control(session, "stop");
        releaseActive(); playback.post(() -> resetTrack(true));
        stopForeground(STOP_FOREGROUND_REMOVE); ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION);
        media.setActive(false); stopSelf();
    }
    void reset(String id, long nextEpoch) { playback.post(() -> { if (id.equals(session)) { epoch = nextEpoch; resetTrack(true); } }); }
    void enqueue(String id, long expectedEpoch, long n, float[] pcm, int sampleRate, boolean last) {
        playback.post(() -> {
            if (!active || !id.equals(session) || epoch != expectedEpoch) return;
            try {
                if (track == null) {
                    rate = sampleRate;
                    int minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
                    track = new AudioTrack.Builder().setAudioAttributes(attributes()).setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                        .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum, rate * 4 / 5)).build();
                    if (track.getState() != AudioTrack.STATE_INITIALIZED) throw new IllegalStateException("AudioTrack init");
                    track.play();
                }
                if (rate != sampleRate || queued - played + pcm.length > rate * 90L) throw new IllegalArgumentException("AudioTrack queue");
                Unit unit = units.isEmpty() ? null : units.get(units.size() - 1);
                if (unit == null || unit.id != n) { unit = new Unit(n, queued); units.add(unit); }
                unit.chunks.add(new Chunk(pcm, queued)); queued += pcm.length; unit.end = queued; unit.complete = last;
                double square = 0, peak = 0;
                for (float sample : pcm) { square += sample * (double) sample; peak = Math.max(peak, Math.abs(sample)); }
                Log.i("InhousePcm", "enqueue session=" + session + " epoch=" + epoch + " unit=" + n + " samples=" + pcm.length + " rate=" + rate + " last=" + last + " peak=" + peak + " rms=" + Math.sqrt(square / pcm.length));
                playback.removeCallbacks(pump); playback.post(pump);
            } catch (Exception error) { fail("native-playback-failed"); }
        });
    }
    void truncate(String id, long expectedEpoch, long after) {
        playback.post(() -> {
            if (!id.equals(session) || expectedEpoch != epoch) return;
            updateHead();
            units.removeIf(u -> u.id > after);
            queued = units.isEmpty() ? played : units.get(units.size() - 1).end;
            // A hardware buffer may contain a future fragment. Flush and refill
            // the retained current tail, using the actual rendered frame count.
            if (written > queued && track != null) {
                track.pause(); track.flush(); headBase = played; written = played; lastHead = headWrap = 0;
                for (Unit u : units) for (Chunk c : u.chunks) c.offset = (int) Math.min(c.pcm.length, Math.max(0, played - c.start));
                track.play();
            }
        });
    }
    private void updateHead() {
        if (track == null) return;
        long head = Integer.toUnsignedLong(track.getPlaybackHeadPosition());
        if (head < lastHead) headWrap += 1L << 32;
        lastHead = head; played = headBase + headWrap + head;
    }
    private final Runnable pump = new Runnable() {
        @Override public void run() {
            if (!active) { publishState(); return; }
            try {
                String currentSession = session;
                updateHead();
                for (Unit u : new ArrayList<>(units)) {
                    if (!u.started && played > u.start) { u.started = true; if (owner != null) owner.emit(currentSession, epoch, "start", u.id, null); }
                    if (u.complete && played >= u.end) { units.remove(u); if (owner != null) owner.emit(currentSession, epoch, "done", u.id, null); }
                }
                if (track != null) outer: for (Unit u : units) for (Chunk c : u.chunks) {
                    if (c.offset >= c.pcm.length) continue;
                    int count = track.write(c.pcm, c.offset, Math.min(4096, c.pcm.length - c.offset), AudioTrack.WRITE_NON_BLOCKING);
                    if (count < 0) throw new IllegalStateException("AudioTrack write " + count);
                    c.offset += count; written += count; break outer;
                }
                if (SystemClock.elapsedRealtime() - lastStatePublish >= 50) publishState();
            } catch (Exception error) { fail("native-playback-failed"); return; }
            playback.postDelayed(this, units.isEmpty() ? 200 : 20);
        }
    };
    private void publishState() {
        JSONObject result = new JSONObject();
        try { result.put("session", session); result.put("epoch", epoch); result.put("active", active); result.put("wakeHeld", wake.isHeld()); result.put("playedFrames", played); result.put("writtenFrames", written); result.put("queuedFrames", queued); result.put("sampleRate", rate); result.put("playedSeconds", rate > 0 ? (double) played / rate : 0); result.put("units", units.size()); result.put("interactive", ((PowerManager) getSystemService(POWER_SERVICE)).isInteractive()); result.put("elapsedMs", SystemClock.elapsedRealtime()); }
        catch (Exception ignored) {}
        state = result.toString();
        lastStatePublish = SystemClock.elapsedRealtime();
        if (SystemClock.elapsedRealtime() - lastStateLog >= 1000 || !active) { lastStateLog = SystemClock.elapsedRealtime(); Log.i("InhousePcmState", state); }
    }
    private void resetTrack(boolean clear) {
        if (track != null) { try { track.pause(); track.flush(); track.release(); } catch (Exception ignored) {} track = null; }
        if (clear) units.clear();
        played = written = queued = headBase = lastHead = headWrap = 0; rate = 0; publishState();
    }
    private void fail(String reason) {
        final String failedSession = session;
        final long failedEpoch = epoch;
        if (owner != null) owner.emit(failedSession, epoch, "error", -1, reason);
        main.post(() -> { if (failedSession.equals(session) && failedEpoch == epoch) stopPlayback(false); });
    }
    @Override public void onDestroy() {
        releaseActive(); playback.removeCallbacks(pump); playback.post(() -> { resetTrack(true); thread.quitSafely(); });
        if (owner != null) owner.detach(this); media.release(); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
