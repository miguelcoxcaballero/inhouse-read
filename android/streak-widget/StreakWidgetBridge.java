package __PACKAGE__;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/** window.InhouseStreak: la web publica la racha para el widget y puede pedir colocarlo. */
public final class StreakWidgetBridge {
    private static final int MAX_DAYS = 400;
    private final Activity activity;
    private final WebView webView;

    public StreakWidgetBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    /** {"days": ["2026-10-22", …], "day": "2026-10-23", "seconds": 120} */
    @JavascriptInterface
    public void update(String json) {
        if (json == null || json.length() > 16000 || !trustedPage()) return;
        try {
            JSONObject input = new JSONObject(json);
            JSONArray days = input.optJSONArray("days");
            JSONArray clean = new JSONArray();
            if (days != null) {
                for (int i = 0; i < days.length() && clean.length() < MAX_DAYS; i++) {
                    String day = days.optString(i, "");
                    if (day.matches("\\d{4}-\\d{2}-\\d{2}")) clean.put(day);
                }
            }
            String day = input.optString("day", "");
            int seconds = Math.max(0, Math.min(86400, input.optInt("seconds", 0)));
            activity.getSharedPreferences(StreakWidgetProvider.PREFERENCES, Activity.MODE_PRIVATE).edit()
                .putString("days", clean.toString())
                .putString("secondsDay", day.matches("\\d{4}-\\d{2}-\\d{2}") ? day : "")
                .putInt("seconds", seconds)
                .apply();
            StreakWidgetProvider.refresh(activity.getApplicationContext());
        } catch (Exception ignored) { }
    }

    /**
     * Último libro para el widget: {"title": "…", "minutes": 200, "cover": "<PNG en base64>"}.
     * Una cadena vacía lo quita (ajuste «Libro en el widget» apagado).
     */
    @JavascriptInterface
    public void updateBook(String json) {
        if (json == null || json.length() > 400000 || !trustedPage()) return;
        android.content.SharedPreferences.Editor editor =
            activity.getSharedPreferences(StreakWidgetProvider.PREFERENCES, Activity.MODE_PRIVATE).edit();
        File cover = new File(activity.getFilesDir(), StreakWidgetProvider.COVER_FILE);
        try {
            if (json.isEmpty()) {
                editor.remove("bookTitle").remove("bookMinutes").apply();
                cover.delete();
            } else {
                JSONObject input = new JSONObject(json);
                String title = input.optString("title", "").trim();
                if (title.isEmpty()) return;
                if (title.length() > 120) title = title.substring(0, 120);
                int minutes = input.has("minutes") ? Math.max(-1, Math.min(1000000, input.optInt("minutes", -1))) : -1;
                String encoded = input.optString("cover", "");
                if (!encoded.isEmpty()) {
                    byte[] png = Base64.decode(encoded, Base64.DEFAULT);
                    // Solo PNG pequeños, comprobados por su firma.
                    if (png.length > 8 && png.length < 300000 && (png[0] & 0xFF) == 0x89 && png[1] == 'P' && png[2] == 'N' && png[3] == 'G') {
                        try (FileOutputStream out = new FileOutputStream(cover)) { out.write(png); }
                    }
                } else if (input.optBoolean("keepCover", false) == false) {
                    cover.delete();
                }
                editor.putString("bookTitle", title).putInt("bookMinutes", minutes).apply();
            }
            StreakWidgetProvider.refresh(activity.getApplicationContext());
        } catch (Exception ignored) { }
    }

    /** true si el lanzador permite añadir el widget desde la app. */
    @JavascriptInterface
    public boolean canPin() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        AppWidgetManager manager = activity.getSystemService(AppWidgetManager.class);
        return manager != null && manager.isRequestPinAppWidgetSupported();
    }

    /** true si ya hay algún widget de la racha en la pantalla de inicio. */
    @JavascriptInterface
    public boolean isPlaced() {
        AppWidgetManager manager = AppWidgetManager.getInstance(activity);
        int[] ids = manager.getAppWidgetIds(new ComponentName(activity, StreakWidgetProvider.class));
        return ids != null && ids.length > 0;
    }

    /** Abre el diálogo del sistema para colocar el widget. */
    @JavascriptInterface
    public void requestPin() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !canPin() || !trustedPage()) return;
        activity.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
            AppWidgetManager manager = activity.getSystemService(AppWidgetManager.class);
            if (manager != null) manager.requestPinAppWidget(new ComponentName(activity, StreakWidgetProvider.class), null, null);
        });
    }

    private boolean trustedPage() {
        // getUrl pertenece al hilo de la interfaz; JavascriptInterface corre en otro.
        try {
            FutureTask<Boolean> check = new FutureTask<>(() -> {
                Uri page = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
                return "https".equals(page.getScheme()) && "miguelcoxcaballero.github.io".equals(page.getHost())
                    && page.getPath() != null && page.getPath().startsWith("/inhouse-read/");
            });
            activity.runOnUiThread(check);
            return check.get(3, TimeUnit.SECONDS);
        } catch (Exception error) { return false; }
    }
}
