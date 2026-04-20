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
import android.os.SystemClock;
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
        if (lm == null) {
            Log.w(TAG, "LocationManager unavailable");
            return null;
        }

        Location loc = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            loc = getCurrentLocation(lm, LocationManager.GPS_PROVIDER, CURRENT_LOC_TIMEOUT_MS);
            Log.i(TAG, "getCurrentLocation(gps) -> " + describe(loc));
            if (loc == null) {
                loc = getCurrentLocation(lm, LocationManager.NETWORK_PROVIDER, CURRENT_LOC_TIMEOUT_MS);
                Log.i(TAG, "getCurrentLocation(network) -> " + describe(loc));
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && loc == null) {
                try {
                    loc = getCurrentLocation(lm, LocationManager.FUSED_PROVIDER, CURRENT_LOC_TIMEOUT_MS);
                    Log.i(TAG, "getCurrentLocation(fused) -> " + describe(loc));
                } catch (Exception e) {
                    Log.w(TAG, "fused provider unavailable: " + e);
                }
            }
        }
        if (loc == null) {
            loc = requestSingleLocation(lm, LocationManager.GPS_PROVIDER, SINGLE_UPDATE_TIMEOUT_MS);
            Log.i(TAG, "requestSingleLocation(gps) -> " + describe(loc));
        }
        if (loc == null) {
            loc = requestSingleLocation(lm, LocationManager.NETWORK_PROVIDER, SINGLE_UPDATE_TIMEOUT_MS);
            Log.i(TAG, "requestSingleLocation(network) -> " + describe(loc));
        }
        if (loc == null) {
            loc = bestLastKnownLocation(lm);
            Log.i(TAG, "bestLastKnownLocation -> " + describe(loc));
        }
        if (loc == null) {
            Log.w(TAG, "resolveFreshLatLonQuery: no fix obtained");
            return null;
        }

        String q = String.format(Locale.US, "%.6f,%.6f", loc.getLatitude(), loc.getLongitude());
        Log.i(TAG, "resolveFreshLatLonQuery -> " + q);
        return q;
    }

    private static String describe(Location loc) {
        if (loc == null) return "null";
        long ageMs = (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos()) / 1_000_000L;
        return String.format(Locale.US, "%s @ %.6f,%.6f ageMs=%d",
            loc.getProvider(), loc.getLatitude(), loc.getLongitude(), ageMs);
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
        boolean fine = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!background) {
            // On Android 10+ this causes the platform to silently return null from getCurrentLocation /
            // getLastKnownLocation and silently drop requestLocationUpdates callbacks when the app is
            // not in the foreground. Calls from WorkManager/BroadcastReceivers will appear to succeed
            // but always return null. Grant via Settings -> App -> Permissions -> Location -> "Allow
            // all the time".
            Log.w(TAG, "ACCESS_BACKGROUND_LOCATION not granted; background location requests will return null");
        }
        return fine || coarse;
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
