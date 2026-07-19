package com.example.weather;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;

/**
 * Posts the ongoing weather notification with a delete intent so dismissal can trigger a refresh.
 * Persists last title/body so we can immediately re-post while background refresh is running.
 */
public final class WeatherNotificationHelper {

    public static final int NOTIFICATION_ID = 71234;
    public static final int UPDATING_NOTIFICATION_ID = 71235;
    public static final String CHANNEL_ID = "current_weather";

    private static final String PREFS = "weather_native_notification";
    public static final String KEY_LAST_TITLE = "last_title";
    public static final String KEY_LAST_BODY = "last_body";
    private static final String KEY_APP_FOREGROUND = "app_foreground";
    private static final String KEY_APP_FOREGROUND_AT = "app_foreground_at";

    /**
     * How long a "foreground" mark stays trustworthy. {@link MainActivity#onPause} clears it on every
     * normal exit, but a force-stop or crash never runs onPause and would otherwise leave the flag
     * stuck true, silently suppressing alert notifications forever.
     */
    private static final long FOREGROUND_STALE_MS = 12L * 60 * 60 * 1000;

    private WeatherNotificationHelper() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID,
            "Current weather",
            NotificationManager.IMPORTANCE_LOW
        );
        ch.setDescription("Live conditions from WeatherAPI.");
        ch.enableVibration(false);
        ch.setSound(null, null);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    public static void show(Context context, String title, String body) {
        ensureChannel(context);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent();
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentPi = PendingIntent.getActivity(context, 1, launch, piFlags);

        Intent dismiss = new Intent(context, WeatherDismissReceiver.class);
        PendingIntent deletePi =
            PendingIntent.getBroadcast(
                context,
                NOTIFICATION_ID,
                dismiss,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_stat_weather_rain)
            .setContentIntent(contentPi)
            .setDeleteIntent(deletePi)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setDefaults(0)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        Notification n = b.build();
        n.flags |= Notification.FLAG_ONGOING_EVENT;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, n);
            persistLastShown(context, title, body);
        }
    }

    public static void persistLastShown(Context context, String title, String body) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_LAST_TITLE, title).putString(KEY_LAST_BODY, body).apply();
    }

    /** Re-post the last known notification text if available. */
    public static boolean showPersistedIfAvailable(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String title = prefs.getString(KEY_LAST_TITLE, null);
        String body = prefs.getString(KEY_LAST_BODY, null);
        if (title == null || title.isEmpty() || body == null || body.isEmpty()) return false;
        show(app, title, body);
        return true;
    }

    public static void cancel(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
    }

    /**
     * Upper bound on how long "Updating\u2026" may stay on screen. {@link WeatherSyncWorker} cancels it
     * as soon as the refresh settles, but that cleanup is lost if the process is killed mid-refresh
     * or the job never gets scheduled (Doze, app standby, OEM battery killers) \u2014 which used to strand
     * the spinner indefinitely. {@code setTimeoutAfter} makes the platform itself retire it, so the
     * bound holds even if none of our code runs again. Comfortably exceeds the worst-case refresh
     * (~20s resolving location + 2 x {@link WeatherSyncWorker} HTTP timeouts).
     */
    private static final long UPDATING_TIMEOUT_MS = 75_000L;

    /** Posts a transient indeterminate-progress notification while a refresh is in flight. */
    public static void showUpdating(Context context) {
        ensureChannel(context);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Updating weather\u2026")
            .setContentText("Fetching latest conditions for your location")
            .setSmallIcon(R.drawable.ic_stat_weather_rain)
            .setProgress(0, 0, true)
            .setTimeoutAfter(UPDATING_TIMEOUT_MS)
            // Dismissible on purpose: if a refresh does wedge, the user can swipe the spinner away
            // instead of waiting it out. It carries no delete intent, so that swipe is inert.
            .setOngoing(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setDefaults(0)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(UPDATING_NOTIFICATION_ID, b.build());
    }

    public static void cancelUpdating(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(UPDATING_NOTIFICATION_ID);
    }

    /** Recorded from {@link MainActivity}'s resume/pause so receivers and workers can read it. */
    public static void setAppForeground(Context context, boolean foreground) {
        Context app = context.getApplicationContext();
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_APP_FOREGROUND, foreground)
            .putLong(KEY_APP_FOREGROUND_AT, System.currentTimeMillis())
            .apply();
    }

    /** True if the user currently has the app open in front of them. */
    public static boolean isAppForeground(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_APP_FOREGROUND, false)) return false;
        long markedAt = prefs.getLong(KEY_APP_FOREGROUND_AT, 0L);
        return System.currentTimeMillis() - markedAt < FOREGROUND_STALE_MS;
    }

    /** True if the ongoing weather notification is currently visible (untagged {@link #NOTIFICATION_ID}). */
    public static boolean isWeatherNotificationPosted(Context context) {
        return isPosted(context, NOTIFICATION_ID);
    }

    /** True while a refresh is in flight, i.e. the "Updating…" spinner is on screen. */
    public static boolean isUpdatingNotificationPosted(Context context) {
        return isPosted(context, UPDATING_NOTIFICATION_ID);
    }

    private static boolean isPosted(Context context, int notificationId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        String pkg = context.getPackageName();
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (!pkg.equals(sbn.getPackageName())) continue;
            if (sbn.getId() != notificationId) continue;
            if (sbn.getTag() != null) continue;
            return true;
        }
        return false;
    }

    /**
     * Posts an error notification in the weather slot when a user-initiated refresh fails (e.g. the
     * device location couldn't be resolved or the network call failed). Reuses {@link #NOTIFICATION_ID}
     * so it replaces the swiped-away weather notification — the user always gets something back — and
     * carries the same delete intent so a swipe retries the refresh, plus a content intent to open the
     * app. A later successful {@link #show} overwrites this in place.
     */
    public static void showError(Context context, String title, String body) {
        ensureChannel(context);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent();
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentPi = PendingIntent.getActivity(context, 1, launch, piFlags);

        Intent dismiss = new Intent(context, WeatherDismissReceiver.class);
        PendingIntent deletePi =
            PendingIntent.getBroadcast(context, NOTIFICATION_ID, dismiss, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_stat_weather_rain)
            .setContentIntent(contentPi)
            .setDeleteIntent(deletePi)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setOngoing(false)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setDefaults(0)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, b.build());
    }
}
