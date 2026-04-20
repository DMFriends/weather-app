package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.BroadcastReceiver.PendingResult;
import android.content.Context;
import android.content.Intent;
import android.text.TextUtils;

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
                // Re-post immediately so it doesn't disappear while fresh location/API are resolving.
                WeatherNotificationHelper.showPersistedIfAvailable(app);
                String q = WeatherLocationHelper.resolveFreshLatLonQuery(app);
                if (TextUtils.isEmpty(q)) {
                    return;
                }
                WeatherLocationHelper.persistQueryBlocking(app, q);
                WeatherSyncWorker.performSync(app, q);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
