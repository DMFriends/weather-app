package com.example.weather;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

/** Stores alert tap targets until the Capacitor WebView consumes them on resume. */
public final class WeatherPendingAlertNavigation {

    private static final String PREFS = "WeatherAppPendingNav";
    private static final String KEY_ALERT = "pending_alert_key";

    private WeatherPendingAlertNavigation() {}

    public static void setPendingAlertKey(Context context, String alertDedupKey) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ALERT, alertDedupKey).apply();
    }

    /** Returns and clears the pending key, if any. */
    @Nullable
    public static String consumePendingAlertKey(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String k = p.getString(KEY_ALERT, null);
        if (k != null) {
            p.edit().remove(KEY_ALERT).apply();
        }
        return k;
    }
}
