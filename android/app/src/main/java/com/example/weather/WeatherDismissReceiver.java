package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.BroadcastReceiver.PendingResult;
import android.content.Context;
import android.content.Intent;

/**
 * When the user dismisses the weather notification, refresh from WeatherAPI using the current device location.
 */
public class WeatherDismissReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Context app = context.getApplicationContext();
                WeatherLocationHelper.tryUpdateQueryFromLastKnownLocation(app);
                WeatherSyncWorker.performSync(app);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
