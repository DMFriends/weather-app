package com.example.weather;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * Fetches forecast from WeatherAPI and updates the notification (e.g. when the app syncs or after dismiss + location refresh).
 */
public class WeatherSyncWorker extends Worker {

    private static final String TAG = "WeatherSyncWorker";
    private static final String PREFS = "weather_native_notification";
    private static final String KEY_API = "api_key";
    private static final String KEY_QUERY = "query_q";
    private static final String KEY_TEMP_UNIT = "temp_unit";
    public static final String UNIQUE_PERIODIC = "weather_periodic_sync";
    public static final String UNIQUE_DISMISS_REFRESH = "weather_dismiss_refresh";
    /** When true, {@link #doWork()} resolves a fresh device location before calling the API. */
    public static final String INPUT_REFRESH_LOCATION = "refresh_location";

    public WeatherSyncWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    /**
     * @param queryOverride If non-null, WeatherAPI is called with this `q` directly.
     */
    public static void performSync(Context ctx, @Nullable String queryOverride) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String apiKey = prefs.getString(KEY_API, null);
        String query = !TextUtils.isEmpty(queryOverride) ? queryOverride : prefs.getString(KEY_QUERY, null);
        if (apiKey == null || apiKey.isEmpty() || query == null || query.isEmpty()) {
            Log.w(TAG, "performSync aborted: apiKey=" + (apiKey == null ? "null" : (apiKey.isEmpty() ? "empty" : "present")) +
                " query=" + (query == null ? "null" : (query.isEmpty() ? "empty" : query)));
            return;
        }
        Log.i(TAG, "performSync calling API with q=" + query);

        try {
            String urlStr =
                "https://api.weatherapi.com/v1/forecast.json?key=" +
                URLEncoder.encode(apiKey, StandardCharsets.UTF_8.name()) +
                "&q=" +
                URLEncoder.encode(query, StandardCharsets.UTF_8.name()) +
                "&days=10&aqi=no&alerts=yes";
            String json = httpGet(urlStr);
            JSONObject root = new JSONObject(json);
            if (root.has("error")) {
                Log.w(TAG, "API error: " + json);
                WeatherNotificationHelper.showPersistedIfAvailable(ctx);
                return;
            }
            replaceUsAlertsWithNwsPointAlerts(root);

            JSONObject loc = root.getJSONObject("location");
            String title = loc.getString("name");
            JSONObject current = root.getJSONObject("current");
            double tempF = current.getDouble("temp_f");
            double windMph = current.getDouble("wind_mph");
            String windDir = current.getString("wind_dir");
            int windDeg = current.optInt("wind_degree", Integer.MIN_VALUE);
            String windDirDeg =
                windDeg != Integer.MIN_VALUE
                    ? String.format(Locale.US, "%s (%d°)", windDir, windDeg)
                    : windDir;
            long apiUpdatedEpoch = current.optLong("last_updated_epoch", 0);

            long nowSec = System.currentTimeMillis() / 1000;
            int precip = computePrecipPct(root, nowSec);

            boolean metric = "C".equals(prefs.getString(KEY_TEMP_UNIT, "F"));
            String body =
                metric
                    ? String.format(
                        Locale.US,
                        "%.1f °C · %.1f km/h %s · %d%% precip",
                        (tempF - 32.0) * 5.0 / 9.0,
                        windMph * 1.60934,
                        windDirDeg,
                        precip)
                    : String.format(Locale.US, "%.1f °F · %.1f mph %s · %d%% precip", tempF, windMph, windDirDeg, precip);

            Log.i(TAG, "performSync posting notification title=" + title + " body=" + body);
            WeatherNotificationHelper.show(ctx, title, body);
            WeatherAlertNotifier.scheduleFromForecastRoot(ctx, root);
        } catch (Exception e) {
            Log.e(TAG, "Weather sync failed", e);
            WeatherNotificationHelper.showPersistedIfAvailable(ctx);
        }
    }

    public static void performSync(Context ctx) {
        performSync(ctx, null);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context app = getApplicationContext();
        boolean refreshLocation = getInputData().getBoolean(INPUT_REFRESH_LOCATION, false);
        Log.i(TAG, "doWork start refreshLocation=" + refreshLocation);
        try {
            if (refreshLocation) {
                String q = WeatherLocationHelper.resolveFreshLatLonQuery(app);
                Log.i(TAG, "resolveFreshLatLonQuery -> " + (q == null ? "null" : q));
                if (TextUtils.isEmpty(q)) {
                    // Couldn't get a fresh fix (GPS cooling off, indoors, Samsung power throttle, etc.).
                    // Still refresh weather data for the last known coords so the notification body is
                    // up-to-date even if the location is slightly stale; only fall back to showing
                    // unchanged persisted text if we don't have any stored coords either.
                    Log.w(TAG, "No fresh fix; calling API with last persisted query instead.");
                    performSync(app);
                } else {
                    WeatherLocationHelper.persistQueryBlocking(app, q);
                    performSync(app, q);
                }
            } else {
                performSync(app);
            }
        } finally {
            WeatherNotificationHelper.cancelUpdating(app);
            Log.i(TAG, "doWork end");
        }
        return Result.success();
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

    private static void replaceUsAlertsWithNwsPointAlerts(JSONObject root) {
        try {
            JSONObject loc = root.optJSONObject("location");
            if (loc == null) return;
            String country = loc.optString("country", "");
            if (!isUnitedStatesCountry(country)) return;

            double lat = loc.optDouble("lat", Double.NaN);
            double lon = loc.optDouble("lon", Double.NaN);
            if (Double.isNaN(lat) || Double.isNaN(lon)) return;

            String point = String.format(Locale.US, "%.4f,%.4f", lat, lon);
            String urlStr = "https://api.weather.gov/alerts/active?point=" + point;
            JSONObject nwsRoot = new JSONObject(httpGet(urlStr));
            JSONArray features = nwsRoot.optJSONArray("features");
            JSONArray pointAlerts = new JSONArray();
            if (features != null) {
                for (int i = 0; i < features.length(); i++) {
                    JSONObject feature = features.optJSONObject(i);
                    JSONObject alert = nwsFeatureToWeatherApiAlert(feature);
                    if (alert != null) pointAlerts.put(alert);
                }
            }

            JSONObject alertsWrap = new JSONObject();
            alertsWrap.put("alert", pointAlerts);
            root.put("alerts", alertsWrap);
        } catch (Exception e) {
            Log.w(TAG, "NWS point alerts unavailable; using WeatherAPI alerts", e);
        }
    }

    private static boolean isUnitedStatesCountry(String country) {
        if (country == null || country.trim().isEmpty()) return false;
        String u = country.trim().toUpperCase(Locale.ROOT);
        return "US".equals(u) || "USA".equals(u) || u.contains("UNITED STATES");
    }

    @Nullable
    private static JSONObject nwsFeatureToWeatherApiAlert(@Nullable JSONObject feature) throws Exception {
        if (feature == null) return null;
        JSONObject props = feature.optJSONObject("properties");
        if (props == null) return null;

        JSONObject out = new JSONObject();
        putIfPresent(out, "identifier", firstNonEmpty(props.optString("id", ""), feature.optString("id", "")));
        putIfPresent(out, "headline", props.optString("headline", ""));
        putIfPresent(out, "msgtype", props.optString("messageType", ""));
        putIfPresent(out, "severity", props.optString("severity", ""));
        putIfPresent(out, "urgency", props.optString("urgency", ""));
        putIfPresent(out, "areas", props.optString("areaDesc", ""));
        putIfPresent(out, "category", normalizeNwsCategory(props.opt("category")));
        putIfPresent(out, "certainty", props.optString("certainty", ""));
        putIfPresent(out, "event", props.optString("event", ""));
        putIfPresent(out, "effective", props.optString("effective", ""));
        putIfPresent(out, "expires", props.optString("expires", ""));
        putIfPresent(out, "desc", props.optString("description", ""));
        putIfPresent(out, "instruction", props.optString("instruction", ""));
        return out;
    }

    private static String normalizeNwsCategory(Object raw) {
        if (raw instanceof JSONArray) {
            JSONArray arr = (JSONArray) raw;
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < arr.length(); i++) {
                String value = arr.optString(i, "");
                if (TextUtils.isEmpty(value)) continue;
                if (sb.length() > 0) sb.append(',');
                sb.append(value);
            }
            return sb.toString();
        }
        return raw == null || raw == JSONObject.NULL ? "" : String.valueOf(raw);
    }

    private static String firstNonEmpty(String... parts) {
        for (String p : parts) {
            if (!TextUtils.isEmpty(p)) return p;
        }
        return "";
    }

    private static void putIfPresent(JSONObject out, String key, String value) throws Exception {
        if (!TextUtils.isEmpty(value)) out.put(key, value);
    }

    private static String httpGet(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) URI.create(urlStr).toURL().openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Accept", urlStr.contains("api.weather.gov") ? "application/geo+json" : "application/json");
        conn.setRequestProperty("User-Agent", "weather-app/2.0 (github.com/DMFriends/weather-app)");
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
