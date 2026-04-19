package com.example.weather;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Legacy: cancel pending refresh alarms from older builds (15-minute chained alarms). No new alarms are scheduled.
 */
public final class WeatherAlarmScheduler {

    private static final int REQUEST_CODE = 71237;

    private WeatherAlarmScheduler() {}

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
