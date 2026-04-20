package com.example.weather;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

/** Resolves current device coordinates for WeatherAPI query `q`. */
public final class WeatherLocationHelper {

    private static final String TAG = "WeatherLocationHelper";
    private static final String PREFS = "weather_native_notification";
    private static final String KEY_QUERY = "query_q";
    private static final long CURRENT_LOC_TIMEOUT_MS = 10_000L;
    private static final long SINGLE_UPDATE_TIMEOUT_MS = 10_000L;

    private WeatherLocationHelper() {}

    /** Returns `lat,lon` from a fresh/best device fix. */
    public static String resolveFreshLatLonQuery(Context context) {
        Context app = context.getApplicationContext();
        if (!hasLocationPermission(app)) {
            Log.w(TAG, "location permission not granted");
            return null;
        }
        LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;

        Location loc = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            loc = getCurrentLocation(lm, LocationManager.GPS_PROVIDER, CURRENT_LOC_TIMEOUT_MS);
            if (loc == null) loc = getCurrentLocation(lm, LocationManager.NETWORK_PROVIDER, CURRENT_LOC_TIMEOUT_MS);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && loc == null) {
                try {
                    loc = getCurrentLocation(lm, LocationManager.FUSED_PROVIDER, CURRENT_LOC_TIMEOUT_MS);
                } catch (Exception ignored) {
                    /* fused may be unavailable */
                }
            }
        }
        if (loc == null) loc = requestSingleLocation(lm, LocationManager.GPS_PROVIDER, SINGLE_UPDATE_TIMEOUT_MS);
        if (loc == null) loc = requestSingleLocation(lm, LocationManager.NETWORK_PROVIDER, SINGLE_UPDATE_TIMEOUT_MS);
        if (loc == null) loc = bestLastKnownLocation(lm);
        if (loc == null) return null;

        return String.format(Locale.US, "%.6f,%.6f", loc.getLatitude(), loc.getLongitude());
    }

    public static void persistQueryBlocking(Context app, String query) {
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_QUERY, query).commit();
    }

    /** Backward compatibility for existing callers. */
    public static boolean tryUpdateQueryFromLastKnownLocation(Context context) {
        String q = resolveFreshLatLonQuery(context);
        if (q == null || q.isEmpty()) return false;
        persistQueryBlocking(context.getApplicationContext(), q);
        return true;
    }

    private static boolean hasLocationPermission(Context app) {
        return ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static Location getCurrentLocation(LocationManager lm, String provider, long timeoutMs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        CompletableFuture<Location> fut = new CompletableFuture<>();
        CancellationSignal cancel = new CancellationSignal();
        ExecutorService exec = Executors.newSingleThreadExecutor();
        try {
            lm.getCurrentLocation(provider, cancel, exec, fut::complete);
            return fut.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            cancel.cancel();
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            exec.shutdown();
        }
    }

    private static Location requestSingleLocation(LocationManager lm, String provider, long timeoutMs) {
        if (!lm.isProviderEnabled(provider)) return null;
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Location> ref = new AtomicReference<>();
        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                ref.set(location);
                latch.countDown();
            }

            @Override
            @Deprecated
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {}
        };
        try {
            lm.requestSingleUpdate(provider, listener, Looper.getMainLooper());
            boolean ok = latch.await(timeoutMs, TimeUnit.MILLISECONDS);
            if (!ok) {
                lm.removeUpdates(listener);
                return null;
            }
            return ref.get();
        } catch (Exception e) {
            try {
                lm.removeUpdates(listener);
            } catch (Exception ignored) {}
            return null;
        }
    }

    private static Location bestLastKnownLocation(LocationManager lm) {
        Location best = null;
        for (String provider : lm.getProviders(true)) {
            try {
                Location l = lm.getLastKnownLocation(provider);
                if (l == null) continue;
                if (best == null || l.getTime() > best.getTime()) {
                    best = l;
                }
            } catch (SecurityException ignored) {}
        }
        return best;
    }
}
