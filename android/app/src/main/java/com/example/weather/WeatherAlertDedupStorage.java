package com.example.weather;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Persists alert-notification dedup state for native paths ({@link WeatherSyncWorker}) and JS
 * ({@link WeatherAlertDedupPlugin}) — WebView localStorage is not visible to WorkManager.
 */
public final class WeatherAlertDedupStorage {

    private static final String PREFS = "WeatherAppAlertDedup";
    private static final String KEY_JSON = "notified_alerts_json";
    static final String KEY_LAST_LOC = "last_alert_location_key";

    private WeatherAlertDedupStorage() {}

    public static String loadMapJson(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_JSON, "{}");
    }

    public static void saveMapJson(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_JSON, json == null ? "{}" : json).apply();
    }

    /** Clears notified-alert entries (used when location changes or user resets). */
    public static void clearMap(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_JSON, "{}").apply();
    }

    /** Clears dedup map + last-location marker (e.g. plugin {@code clear}). */
    public static void clearAll(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    /**
     * Mirrors TS {@code syncAlertNotifications} location handling: when rounded lat/lon changes,
     * wipe dedup so alerts for the new place can notify.
     */
    public static void maybeClearDedupForLocation(Context context, double lat, double lon) {
        String locKey = String.format(java.util.Locale.US, "%.3f,%.3f", lat, lon);
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String prev = p.getString(KEY_LAST_LOC, null);
        if (prev != null && !prev.equals(locKey)) {
            clearMap(context);
        }
        p.edit().putString(KEY_LAST_LOC, locKey).apply();
    }

    public static JSONObject pruneExpiredNotifiedMap(String rawJson, long nowMs) {
        try {
            JSONObject in = new JSONObject(rawJson == null || rawJson.isEmpty() ? "{}" : rawJson);
            JSONObject out = new JSONObject();
            Iterator<String> keys = in.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                long exp = in.optLong(k, 0);
                if (exp >= nowMs) {
                    try {
                        out.put(k, exp);
                    } catch (JSONException ignored) {
                    }
                }
            }
            return out;
        } catch (Exception e) {
            return new JSONObject();
        }
    }
}
