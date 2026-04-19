package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.BroadcastReceiver.PendingResult;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.work.WorkManager;

/**
 * After reboot or app update, show cached weather if configured; optionally one network refresh (no periodic timers).
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

        WeatherAlarmScheduler.cancel(app);
        WorkManager.getInstance(app).cancelUniqueWork(WeatherSyncWorker.UNIQUE_PERIODIC);

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                WeatherLocationHelper.tryUpdateQueryFromLastKnownLocation(app);
                WeatherSyncWorker.performSync(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}

