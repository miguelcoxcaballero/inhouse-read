package __PACKAGE__;

import android.app.Activity;
import android.app.AutomaticZenRule;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.service.notification.Condition;
import android.service.notification.ZenPolicy;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;

/**
 * «Sin avisos al leer»: mientras el lector ocupa la pantalla, un modo No molestar
 * propio de la app oculta las notificaciones emergentes de otras apps. Siguen
 * llegando al panel en silencio; las alarmas, el audio de la lectura y las
 * llamadas no se tocan. Se apaga al salir del libro o de la app (onPause).
 *
 * window.InhouseReadingFocus: state(), setEnabled(boolean), openAccess().
 */
public final class ReadingFocus {
    private static final String PREFERENCES = "inhouse_reading_focus";
    private static final Uri CONDITION = Uri.parse("condition://inhouse-read/reading");
    private static Boolean applied;

    private ReadingFocus() { }

    static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static boolean enabled(Context context) {
        return preferences(context).getBoolean("enabled", true);
    }

    private static boolean access(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.isNotificationPolicyAccessGranted();
    }

    /** Llamado desde applyReadingDisplay: active = libro abierto, app en primer plano. */
    public static void apply(Activity activity, boolean active) {
        if (!supported()) return;
        Context context = activity.getApplicationContext();
        boolean want = active && enabled(context) && access(context);
        // Tras un cierre inesperado el modo pudo quedar encendido: el primer apply lo apaga.
        if (applied != null && applied == want) return;
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null || !access(context)) { applied = false; return; }
            String id = ruleId(context, manager, want);
            if (id == null) { applied = false; return; }
            manager.setAutomaticZenRuleState(id, new Condition(CONDITION, "Leyendo",
                want ? Condition.STATE_TRUE : Condition.STATE_FALSE));
            applied = want;
        } catch (RuntimeException ignored) {
            applied = false;
        }
    }

    /** La regla de la app; solo se crea cuando hace falta encenderla. */
    private static String ruleId(Context context, NotificationManager manager, boolean create) {
        String id = preferences(context).getString("rule", null);
        if (id != null && manager.getAutomaticZenRule(id) != null) return id;
        if (!create) return null;
        ZenPolicy policy = new ZenPolicy.Builder()
            .disallowAllSounds()
            .allowAlarms(true)
            .allowMedia(true)
            .allowCalls(ZenPolicy.PEOPLE_TYPE_ANYONE)
            .allowRepeatCallers(true)
            .showInNotificationList(true)
            .showBadges(true)
            .showStatusBarIcons(true)
            .showPeeking(false)
            .showFullScreenIntent(false)
            .showLights(false)
            .showInAmbientDisplay(false)
            .build();
        AutomaticZenRule rule = new AutomaticZenRule("Leyendo en Inhouse Read", null,
            new ComponentName(context, context.getPackageName() + ".MainActivity"), CONDITION, policy,
            NotificationManager.INTERRUPTION_FILTER_PRIORITY, true);
        id = manager.addAutomaticZenRule(rule);
        preferences(context).edit().putString("rule", id).apply();
        return id;
    }

    /** El puente de la web, solo para la página de Inhouse Read. */
    public static final class Bridge {
        private final Activity activity;
        private final WebView webView;

        public Bridge(Activity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
        }

        /** {"supported": true, "enabled": true, "access": false} */
        @JavascriptInterface
        public String state() {
            JSONObject state = new JSONObject();
            try {
                Context context = activity.getApplicationContext();
                state.put("supported", supported());
                state.put("enabled", enabled(context));
                state.put("access", supported() && access(context));
            } catch (Exception ignored) { }
            return state.toString();
        }

        @JavascriptInterface
        public void setEnabled(boolean value) {
            if (!supported() || !trustedPage()) return;
            preferences(activity).edit().putBoolean("enabled", value).apply();
            // Fuera del lector no hay nada encendido; apply(false) apaga si lo estuviera.
            if (!value) activity.runOnUiThread(() -> apply(activity, false));
        }

        /** Abre el ajuste del sistema donde se concede «No molestar» a la app. */
        @JavascriptInterface
        public void openAccess() {
            if (!supported() || !trustedPage()) return;
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                } catch (RuntimeException ignored) { }
            });
        }

        private boolean trustedPage() {
            try {
                java.util.concurrent.FutureTask<String> url = new java.util.concurrent.FutureTask<>(webView::getUrl);
                activity.runOnUiThread(url);
                Uri page = Uri.parse(String.valueOf(url.get(2, java.util.concurrent.TimeUnit.SECONDS)));
                return "https".equals(page.getScheme())
                    && "miguelcoxcaballero.github.io".equals(page.getHost())
                    && String.valueOf(page.getPath()).startsWith("/inhouse-read/");
            } catch (Exception ignored) {
                return false;
            }
        }
    }
}
