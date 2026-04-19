package com.example.weather;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;

import androidx.core.content.ContextCompat;

import java.util.Locale;

/**
 * Writes {@code query_q} prefs to {@code lat,lon} from the freshest last-known fix (no periodic updates).
 * Used after the user dismisses the notification so the next API call matches current device location.
 */
public final class WeatherLocationHelper {

    private static final String PREFS = "weather_native_notification";
    private static final String KEY_QUERY = "query_q";

    private WeatherLocationHelper() {}

    /**
     * @return true if prefs were updated with a new coordinate query
     */
    public static boolean tryUpdateQueryFromLastKnownLocation(Context context) {
        Context app = context.getApplicationContext();
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return false;

        Location best = null;
        for (String provider : lm.getProviders(true)) {
            try {
                Location l = lm.getLastKnownLocation(provider);
                if (l == null) continue;
                if (best == null || l.getTime() > best.getTime()) {
                    best = l;
                }
            } catch (SecurityException ignored) {
                // ignore
            }
        }
        if (best == null) return false;

        String q = String.format(Locale.US, "%.6f,%.6f", best.getLatitude(), best.getLongitude());
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_QUERY, q).apply();
        return true;
    }
}
