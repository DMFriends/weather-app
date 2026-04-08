package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Alarm tick: refresh weather notification, then schedule the next tick.
 */
public class WeatherAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Context app = context.getApplicationContext();
                WeatherSyncWorker.performSync(app);
                WeatherAlarmScheduler.scheduleNext(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}

