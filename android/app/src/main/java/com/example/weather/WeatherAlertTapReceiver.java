package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles taps on alert notifications scheduled from {@link WeatherAlertNotifier}. Stores the
 * dedup key for {@link WeatherNativeNotificationPlugin#consumePendingAlertKey}.
 */
public class WeatherAlertTapReceiver extends BroadcastReceiver {

    static final String EXTRA_ALERT_KEY = "weatherAlertKey";

    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        String key = intent == null ? null : intent.getStringExtra(EXTRA_ALERT_KEY);
        if (key != null && !key.isEmpty()) {
            WeatherPendingAlertNavigation.setPendingAlertKey(app, key);
        }
        Intent launch = new Intent(app, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        app.startActivity(launch);
    }
}
