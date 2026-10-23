package __PACKAGE__;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import java.io.File;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Widget de la racha de lectura. La web le pasa los días cumplidos
 * (StreakWidgetBridge); el widget calcula la racha con la fecha actual, así
 * que al cambiar de día se pone en gris aunque la app no se abra.
 */
public final class StreakWidgetProvider extends AppWidgetProvider {
    static final String PREFERENCES = "reading-streak-widget";
    static final int GOAL_SECONDS = 300;
    private static final int MEDIUM_DP = 100;
    private static final int TALL_DP = 100;
    private static final int LARGE_DP = 180;
    private static final int WIDE_DP = 260;
    private static final int ORANGE = 0xFFFF9600;
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

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        // Antes de Android 12 el diseño se elige aquí, con el ancho que da el lanzador.
        render(context, manager, new int[] {id});
    }

    /** Lo que muestran los tres diseños, calculado una vez por actualización. */
    private static final class Model {
        boolean doneToday;
        int streak;
        int seconds;
        String status;
        final int[] dots = new int[7];
        int today = -1;
        String bookTitle;
        String bookLeft;
        int bookMinutes = -1;
        Bitmap cover;
    }

    private static Model model(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        Set<String> done = new HashSet<>();
        try {
            JSONArray days = new JSONArray(preferences.getString("days", "[]"));
            for (int i = 0; i < days.length(); i++) done.add(days.getString(i));
        } catch (Exception ignored) { }

        Model model = new Model();
        Calendar now = Calendar.getInstance();
        String today = dayKey(now);
        model.doneToday = done.contains(today);
        model.seconds = today.equals(preferences.getString("secondsDay", "")) ? preferences.getInt("seconds", 0) : 0;
        if (model.doneToday) model.seconds = GOAL_SECONDS;

        Calendar cursor = (Calendar) now.clone();
        if (!model.doneToday) cursor.add(Calendar.DAY_OF_MONTH, -1);
        while (done.contains(dayKey(cursor)) && model.streak < 5000) {
            model.streak++;
            cursor.add(Calendar.DAY_OF_MONTH, -1);
        }

        int minutes = (int) Math.ceil(Math.max(0, GOAL_SECONDS - model.seconds) / 60.0);
        if (model.doneToday) model.status = "Hoy ya has leído";
        else if (model.seconds > 0) model.status = minutes == 1 ? "Falta 1 min hoy" : "Faltan " + minutes + " min hoy";
        else if (model.streak > 0) model.status = "Lee 5 min hoy";
        else model.status = "Empieza hoy: 5 min";

        // Semana de lunes a domingo, como en la app.
        Calendar day = (Calendar) now.clone();
        day.add(Calendar.DAY_OF_MONTH, -((day.get(Calendar.DAY_OF_WEEK) + 5) % 7));
        for (int i = 0; i < 7; i++) {
            String key = dayKey(day);
            int compare = key.compareTo(today);
            if (compare == 0) model.today = i;
            if (done.contains(key)) model.dots[i] = R.drawable.streak_dot_done;
            else if (compare == 0) model.dots[i] = R.drawable.streak_dot_today;
            else if (compare > 0) model.dots[i] = R.drawable.streak_dot_future;
            else model.dots[i] = R.drawable.streak_dot_missed;
            day.add(Calendar.DAY_OF_MONTH, 1);
        }
        // Último libro abierto (StreakWidgetBridge.updateBook); vacío si el ajuste está apagado.
        model.bookTitle = preferences.getString("bookTitle", null);
        int left = preferences.getInt("bookMinutes", -1);
        model.bookMinutes = left;
        if (model.bookTitle != null && left >= 0) model.bookLeft = left < 1 ? "Casi terminado" : "Quedan " + duration(left);
        File cover = new File(context.getFilesDir(), COVER_FILE);
        if (model.bookTitle != null && cover.isFile()) model.cover = BitmapFactory.decodeFile(cover.getPath());
        return model;
    }

    static final String COVER_FILE = "streak-widget-cover.png";

    private static String duration(int minutes) {
        if (minutes < 60) return minutes + " min";
        int hours = minutes / 60, rest = minutes % 60;
        return rest == 0 || hours >= 10 ? hours + " h" : hours + " h " + rest + " min";
    }

    private static String shortDuration(int minutes) {
        return minutes < 60 ? Math.max(1, minutes) + " min" : Math.round(minutes / 60f) + " h";
    }

    /** Un diseño concreto. Solo toca vistas que existen en ese diseño. */
    private static RemoteViews build(Context context, Model model, int layout) {
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        boolean tiny = layout == R.layout.streak_widget_tiny;
        boolean row = layout == R.layout.streak_widget_row;
        boolean small = layout == R.layout.streak_widget_small;
        boolean wide = layout == R.layout.streak_widget_wide;
        boolean week = wide || layout == R.layout.streak_widget;
        views.setInt(R.id.streak_widget_root, "setBackgroundResource",
            model.doneToday ? R.drawable.streak_widget_bg_lit : R.drawable.streak_widget_bg);
        views.setImageViewResource(R.id.streak_flame, model.doneToday ? R.drawable.streak_flame_lit : R.drawable.streak_flame_idle);
        views.setViewVisibility(R.id.streak_count_lit, model.doneToday ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.streak_count_idle, model.doneToday ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.streak_count_lit, String.valueOf(model.streak));
        views.setTextViewText(R.id.streak_count_idle, String.valueOf(model.streak));
        boolean book = model.bookTitle != null;

        String summary = model.streak + (model.streak == 1 ? " día de racha. " : " días de racha. ") + model.status;
        if (tiny) {
            views.setContentDescription(R.id.streak_widget_root, summary);
        } else if (row) {
            views.setTextViewText(R.id.streak_label, model.streak == 1 ? "día" : "días");
            int minutes = (int) Math.ceil(Math.max(0, GOAL_SECONDS - model.seconds) / 60.0);
            CharSequence line;
            if (!model.doneToday) line = model.seconds > 0 ? "Faltan " + minutes + " min" : "Lee 5 min";
            else if (book && model.bookMinutes >= 1) line = orange(duration(model.bookMinutes));
            else line = null;
            // Cumplido y sin libro: solo la llama y la cifra.
            views.setViewVisibility(R.id.streak_status, line != null ? View.VISIBLE : View.GONE);
            if (line != null) views.setTextViewText(R.id.streak_status, line);
            views.setContentDescription(R.id.streak_widget_root, summary);
        } else if (small) {
            views.setTextViewText(R.id.streak_label, model.streak == 1 ? "día" : "días");
            views.setViewVisibility(R.id.streak_book, book && model.bookMinutes >= 1 ? View.VISIBLE : View.GONE);
            if (book && model.bookMinutes >= 1) views.setTextViewText(R.id.streak_book, shortDuration(model.bookMinutes));
            views.setContentDescription(R.id.streak_widget_root, summary);
        } else {
            views.setTextViewText(R.id.streak_label, model.streak == 1 ? "día de racha" : "días de racha");
            // Con el día cumplido la llama encendida ya lo dice: sin texto de estado.
            views.setViewVisibility(R.id.streak_status, model.doneToday ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.streak_status, model.status);
            // Barra solo mientras el día está a medias: ni vacía ni ya cumplida.
            boolean partial = !model.doneToday && model.seconds > 0;
            views.setViewVisibility(R.id.streak_progress, partial ? View.VISIBLE : View.GONE);
            if (partial) views.setProgressBar(R.id.streak_progress, GOAL_SECONDS, model.seconds, false);
            if (wide) {
                views.setViewVisibility(R.id.streak_book_column, book ? View.VISIBLE : View.GONE);
                if (book) {
                    views.setViewVisibility(R.id.streak_book_left, model.bookLeft != null ? View.VISIBLE : View.GONE);
                    if (model.bookLeft != null) views.setTextViewText(R.id.streak_book_left, model.bookLeft);
                }
            } else {
                // Solo el tiempo que queda: la portada ya dice qué libro es.
                boolean left = book && model.bookLeft != null;
                views.setViewVisibility(R.id.streak_book, left ? View.VISIBLE : View.GONE);
                if (left) views.setTextViewText(R.id.streak_book, model.bookLeft);
            }
            views.setViewVisibility(R.id.streak_cover, book && model.cover != null ? View.VISIBLE : View.GONE);
            if (book && model.cover != null) {
                views.setImageViewBitmap(R.id.streak_cover, model.cover);
                views.setContentDescription(R.id.streak_cover, "Portada de " + model.bookTitle);
            }
        }
        if (week) {
            for (int i = 0; i < 7; i++) {
                views.setImageViewResource(DAY_DOTS[i], model.dots[i]);
                views.setTextViewText(DAY_LABELS[i], WEEKDAYS[i]);
                if (i == model.today) views.setTextColor(DAY_LABELS[i], ORANGE);
            }
        }
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            views.setOnClickPendingIntent(R.id.streak_widget_root, PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return views;
    }

    /** Texto en naranja y negrita, como las cifras de la racha. */
    private static SpannableStringBuilder orange(String text) {
        SpannableStringBuilder line = new SpannableStringBuilder(text);
        line.setSpan(new ForegroundColorSpan(ORANGE), 0, line.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        line.setSpan(new StyleSpan(Typeface.BOLD), 0, line.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return line;
    }

    /** El diseño mayor que cabe en ese tamaño (dp). Con una sola fila de alto, los de una fila. */
    private static int layoutFor(int widthDp, int heightDp) {
        if (heightDp < TALL_DP) return widthDp >= MEDIUM_DP ? R.layout.streak_widget_row : R.layout.streak_widget_tiny;
        if (widthDp >= WIDE_DP) return R.layout.streak_widget_wide;
        if (widthDp >= LARGE_DP) return R.layout.streak_widget;
        if (widthDp >= MEDIUM_DP) return R.layout.streak_widget_medium;
        return R.layout.streak_widget_small;
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        Model model = model(context);
        for (int id : ids) {
            RemoteViews views;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+: el lanzador elige el diseño mayor que quepa al redimensionar.
                Map<SizeF, RemoteViews> sizes = new ArrayMap<>();
                sizes.put(new SizeF(40f, 40f), build(context, model, R.layout.streak_widget_tiny));
                sizes.put(new SizeF(MEDIUM_DP, 40f), build(context, model, R.layout.streak_widget_row));
                sizes.put(new SizeF(40f, TALL_DP), build(context, model, R.layout.streak_widget_small));
                sizes.put(new SizeF(MEDIUM_DP, TALL_DP), build(context, model, R.layout.streak_widget_medium));
                sizes.put(new SizeF(LARGE_DP, TALL_DP), build(context, model, R.layout.streak_widget));
                sizes.put(new SizeF(WIDE_DP, TALL_DP), build(context, model, R.layout.streak_widget_wide));
                views = new RemoteViews(sizes);
            } else {
                Bundle options = manager.getAppWidgetOptions(id);
                // En vertical el widget mide el ancho mínimo por el alto máximo.
                int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                views = build(context, model, layoutFor(width == 0 ? WIDE_DP : width, height == 0 ? TALL_DP : height));
            }
            manager.updateAppWidget(id, views);
        }
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
