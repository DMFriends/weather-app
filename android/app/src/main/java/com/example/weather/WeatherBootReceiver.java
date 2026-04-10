package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * After reboot or app update, resume refresh alarms if the user previously enabled weather notifications.
 */
public class WeatherBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences("weather_native_notification", Context.MODE_PRIVATE);
        String api = prefs.getString("api_key", null);
        String q = prefs.getString("query_q", null);
        if (api == null || api.isEmpty() || q == null || q.isEmpty()) return;

        // Show last known conditions immediately; network refresh runs in the background.
        WeatherNotificationHelper.showCachedIfAvailable(app);

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                WeatherSyncWorker.performSync(app);
                WeatherAlarmScheduler.scheduleNext(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}

