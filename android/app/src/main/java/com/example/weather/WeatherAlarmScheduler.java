package com.example.weather;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Schedules a refresh via chained alarms.
 *
 * Periodic WorkManager is often deferred for hours under Doze; alarms are much closer
 * to the desired cadence (exact alarms may still require user approval on Android 12+).
 */
public final class WeatherAlarmScheduler {

    private static final int REQUEST_CODE = 71237;
    private static final long INTERVAL_MS = 15 * 60 * 1000L;

    private WeatherAlarmScheduler() {}

    public static void scheduleNext(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences("weather_native_notification", Context.MODE_PRIVATE);
        String api = prefs.getString("api_key", null);
        String q = prefs.getString("query_q", null);
        if (api == null || api.isEmpty() || q == null || q.isEmpty()) return;

        AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        long triggerAt = System.currentTimeMillis() + INTERVAL_MS;
        PendingIntent pi = pendingIntent(app);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else {
            am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
    }

    public static void cancel(Context context) {
        Context app = context.getApplicationContext();
        AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(pendingIntent(app));
    }

    private static PendingIntent pendingIntent(Context app) {
        Intent intent = new Intent(app, WeatherAlarmReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(app, REQUEST_CODE, intent, flags);
    }
}

