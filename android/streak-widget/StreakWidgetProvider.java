package __PACKAGE__;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Widget de la racha de lectura. La web le pasa los días cumplidos
 * (StreakWidgetBridge); el widget calcula la racha con la fecha actual, así
 * que al cambiar de día se pone en gris aunque la app no se abra.
 */
public final class StreakWidgetProvider extends AppWidgetProvider {
    static final String PREFERENCES = "reading-streak-widget";
    static final int GOAL_SECONDS = 300;
    private static final String ACTION_MIDNIGHT = "__PACKAGE__.STREAK_WIDGET_MIDNIGHT";
    private static final String[] WEEKDAYS = {"L", "M", "X", "J", "V", "S", "D"};
    private static final int[] DAY_DOTS = {
        R.id.streak_day_0, R.id.streak_day_1, R.id.streak_day_2, R.id.streak_day_3,
        R.id.streak_day_4, R.id.streak_day_5, R.id.streak_day_6
    };
    private static final int[] DAY_LABELS = {
        R.id.streak_day_label_0, R.id.streak_day_label_1, R.id.streak_day_label_2, R.id.streak_day_label_3,
        R.id.streak_day_label_4, R.id.streak_day_label_5, R.id.streak_day_label_6
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, manager, ids);
        scheduleMidnight(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_MIDNIGHT.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) refresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(midnightIntent(context));
    }

    /** Vuelve a dibujar todos los widgets colocados, si hay alguno. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, StreakWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        render(context, manager, ids);
        scheduleMidnight(context);
    }

    static String dayKey(Calendar day) {
        return String.format(Locale.ROOT, "%04d-%02d-%02d",
            day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH));
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        Set<String> done = new HashSet<>();
        try {
            JSONArray days = new JSONArray(preferences.getString("days", "[]"));
            for (int i = 0; i < days.length(); i++) done.add(days.getString(i));
        } catch (Exception ignored) { }

        Calendar now = Calendar.getInstance();
        String today = dayKey(now);
        boolean doneToday = done.contains(today);
        int seconds = today.equals(preferences.getString("secondsDay", "")) ? preferences.getInt("seconds", 0) : 0;
        if (doneToday) seconds = GOAL_SECONDS;

        Calendar cursor = (Calendar) now.clone();
        if (!doneToday) cursor.add(Calendar.DAY_OF_MONTH, -1);
        int streak = 0;
        while (done.contains(dayKey(cursor)) && streak < 5000) {
            streak++;
            cursor.add(Calendar.DAY_OF_MONTH, -1);
        }

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.streak_widget);
        views.setImageViewResource(R.id.streak_flame, doneToday ? R.drawable.streak_flame_lit : R.drawable.streak_flame_idle);
        views.setViewVisibility(R.id.streak_count_lit, doneToday ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.streak_count_idle, doneToday ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.streak_count_lit, String.valueOf(streak));
        views.setTextViewText(R.id.streak_count_idle, String.valueOf(streak));
        views.setTextViewText(R.id.streak_label, streak == 1 ? "día de racha" : "días de racha");
        int minutes = (int) Math.ceil(Math.max(0, GOAL_SECONDS - seconds) / 60.0);
        String status;
        if (doneToday) status = "Hoy ya has leído";
        else if (seconds > 0) status = minutes == 1 ? "Te falta 1 minuto hoy" : "Te faltan " + minutes + " minutos hoy";
        else if (streak > 0) status = "Lee 5 minutos para no perderla";
        else status = "Lee 5 minutos para empezar";
        views.setTextViewText(R.id.streak_status, status);
        // Barra solo mientras el día está a medias: ni vacía ni ya cumplida.
        boolean partial = !doneToday && seconds > 0;
        views.setViewVisibility(R.id.streak_progress, partial ? View.VISIBLE : View.GONE);
        if (partial) views.setProgressBar(R.id.streak_progress, GOAL_SECONDS, seconds, false);

        // Semana de lunes a domingo, como en la app.
        Calendar day = (Calendar) now.clone();
        int offset = (day.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        day.add(Calendar.DAY_OF_MONTH, -offset);
        for (int i = 0; i < 7; i++) {
            String key = dayKey(day);
            int compare = key.compareTo(today);
            int drawable;
            if (done.contains(key)) drawable = R.drawable.streak_dot_done;
            else if (compare == 0) drawable = R.drawable.streak_dot_today;
            else if (compare > 0) drawable = R.drawable.streak_dot_future;
            else drawable = R.drawable.streak_dot_missed;
            views.setImageViewResource(DAY_DOTS[i], drawable);
            views.setTextViewText(DAY_LABELS[i], WEEKDAYS[i]);
            if (compare == 0) views.setTextColor(DAY_LABELS[i], 0xFFFF9600);
            day.add(Calendar.DAY_OF_MONTH, 1);
        }

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            views.setOnClickPendingIntent(R.id.streak_widget_root, PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    private static PendingIntent midnightIntent(Context context) {
        Intent intent = new Intent(context, StreakWidgetProvider.class).setAction(ACTION_MIDNIGHT);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Una alarma inexacta poco después de medianoche (no necesita permisos de alarma exacta). */
    private static void scheduleMidnight(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Calendar next = Calendar.getInstance();
        next.add(Calendar.DAY_OF_MONTH, 1);
        next.set(Calendar.HOUR_OF_DAY, 0);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 30);
        next.set(Calendar.MILLISECOND, 0);
        alarms.set(AlarmManager.RTC, next.getTimeInMillis(), midnightIntent(context));
    }
}
