package com.example.weather;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * Posts the ongoing weather notification with a delete intent so dismissal can trigger a refresh.
 * Persisting last title/body is kept for debugging, but we avoid re-posting cached content.
 */
public final class WeatherNotificationHelper {

    public static final int NOTIFICATION_ID = 71234;
    public static final String CHANNEL_ID = "current_weather";

    private static final String PREFS = "weather_native_notification";
    public static final String KEY_LAST_TITLE = "last_title";
    public static final String KEY_LAST_BODY = "last_body";

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
        PendingIntent deletePi = PendingIntent.getBroadcast(context, 2, dismiss, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

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

    public static void cancel(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
    }
}
