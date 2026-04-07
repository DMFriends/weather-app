package com.example.weather;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Fetches forecast from WeatherAPI and updates the notification. Runs periodically and after dismiss.
 */
public class WeatherSyncWorker extends Worker {

    private static final String TAG = "WeatherSyncWorker";
    private static final String PREFS = "weather_native_notification";
    private static final String KEY_API = "api_key";
    private static final String KEY_QUERY = "query_q";
    private static final String UNIQUE_PERIODIC = "weather_periodic_sync";

    public WeatherSyncWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    public static void schedulePeriodic(Context context) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(WeatherSyncWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(UNIQUE_PERIODIC, androidx.work.ExistingPeriodicWorkPolicy.UPDATE, periodic);
    }

    public static void runOnce(Context context) {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest once = new OneTimeWorkRequest.Builder(WeatherSyncWorker.class).setConstraints(constraints).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueue(once);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String apiKey = prefs.getString(KEY_API, null);
        String query = prefs.getString(KEY_QUERY, null);
        if (apiKey == null || apiKey.isEmpty() || query == null || query.isEmpty()) {
            return Result.success();
        }

        try {
            String urlStr =
                "https://api.weatherapi.com/v1/forecast.json?key=" +
                URLEncoder.encode(apiKey, StandardCharsets.UTF_8.name()) +
                "&q=" +
                URLEncoder.encode(query, StandardCharsets.UTF_8.name()) +
                "&days=2&aqi=no&alerts=no";
            String json = httpGet(urlStr);
            JSONObject root = new JSONObject(json);
            if (root.has("error")) {
                Log.w(TAG, "API error: " + json);
                return Result.success();
            }

            JSONObject loc = root.getJSONObject("location");
            String title = loc.getString("name");
            JSONObject current = root.getJSONObject("current");
            double tempF = current.getDouble("temp_f");
            double windMph = current.getDouble("wind_mph");
            String windDir = current.getString("wind_dir");

            long nowSec = System.currentTimeMillis() / 1000;
            int precip = computePrecipPct(root, nowSec);

            String body =
                String.format(java.util.Locale.US, "%.1f °F · %.0f mph %s · %d%% precip", tempF, windMph, windDir, precip);

            WeatherNotificationHelper.show(ctx, title, body);
            return Result.success();
        } catch (Exception e) {
            Log.e(TAG, "Weather sync failed", e);
            return Result.success();
        }
    }

    private static int computePrecipPct(JSONObject root, long nowSec) throws Exception {
        JSONObject forecast = root.optJSONObject("forecast");
        if (forecast == null) return 0;
        JSONArray days = forecast.optJSONArray("forecastday");
        if (days == null || days.length() == 0) return 0;

        int bestRain = 0;
        int bestSnow = 0;
        long bestDist = Long.MAX_VALUE;

        for (int d = 0; d < days.length(); d++) {
            JSONObject day = days.getJSONObject(d);
            JSONArray hours = day.optJSONArray("hour");
            if (hours == null) continue;
            for (int h = 0; h < hours.length(); h++) {
                JSONObject hour = hours.getJSONObject(h);
                long te = hour.getLong("time_epoch");
                long dist = Math.abs(te - nowSec);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestRain = hour.optInt("chance_of_rain", 0);
                    bestSnow = hour.optInt("chance_of_snow", 0);
                }
            }
        }
        return Math.max(0, Math.min(100, Math.max(bestRain, bestSnow)));
    }

    private static String httpGet(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");
        int code = conn.getResponseCode();
        InputStream in = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
        if (in == null) throw new java.io.IOException("HTTP " + code);
        try (InputStream stream = in) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            return sb.toString();
        } finally {
            conn.disconnect();
        }
    }
}
