package com.example.weather;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Schedules heads-up notifications for WeatherAPI alerts after native forecast refresh (e.g.
 * swipe-dismiss on the ongoing weather notification). Dedup strings match TS ({@link #dedupKey}). Each post
 * uses a sequential notification id in the reserved band so postings do not replace each other in-batch.
 */
public final class WeatherAlertNotifier {

    private static final String TAG = "WeatherAlertNotifier";

    static final String CHANNEL_ID = "weather_alerts";

    private static final int ALERT_NOTIFICATION_ID_BASE = 80_000;
    private static final int ALERT_NOTIFICATION_ID_RANGE = 9_000;

    private static final Pattern WS = Pattern.compile("\\s+");

    private WeatherAlertNotifier() {}

    /** Clears any OS alert notifications in the app's reserved id band (Capacitor + native). */
    public static void cancelAllScheduledAlertNotifications(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        for (int id = ALERT_NOTIFICATION_ID_BASE; id < ALERT_NOTIFICATION_ID_BASE + ALERT_NOTIFICATION_ID_RANGE; id++) {
            try {
                nm.cancel(null, id);
            } catch (Exception ignored) {
            }
        }
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch =
            new NotificationChannel(
                CHANNEL_ID,
                "Weather alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
        ch.setDescription("Severe weather alerts for your saved location.");
        ch.enableVibration(true);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    /**
     * Parses {@code alerts} from {@code forecast.json}: clears prior alert notifications in the app id
     * band, posts current non-expired alerts, persists dedup map for tap routing.
     */
    public static void scheduleFromForecastRoot(Context context, JSONObject root) {
        try {
            scheduleFromForecastRootInner(context, root);
        } catch (Exception e) {
            Log.e(TAG, "scheduleFromForecastRoot failed", e);
        }
    }

    private static void scheduleFromForecastRootInner(Context context, JSONObject root) throws JSONException {
        Context app = context.getApplicationContext();

        JSONObject locObj = root.optJSONObject("location");
        if (locObj != null) {
            double lat = locObj.optDouble("lat", Double.NaN);
            double lon = locObj.optDouble("lon", Double.NaN);
            if (!Double.isNaN(lat) && !Double.isNaN(lon)) {
                WeatherAlertDedupStorage.maybeClearDedupForLocation(app, lat, lon);
            }
        }

        cancelAllScheduledAlertNotifications(app);

        JSONObject alertsWrap = root.optJSONObject("alerts");
        JSONArray alerts = coerceAlertsArray(alertsWrap);
        if (alerts == null || alerts.length() == 0) {
            WeatherAlertDedupStorage.saveMapJson(app, "{}");
            return;
        }

        NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            WeatherAlertDedupStorage.saveMapJson(app, "{}");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !nm.areNotificationsEnabled()) {
            Log.w(TAG, "Notifications disabled; skip alert scheduling");
            WeatherAlertDedupStorage.saveMapJson(app, "{}");
            return;
        }

        ensureChannel(app);

        long now = System.currentTimeMillis();
        JSONObject notified = new JSONObject();

        /** One id per posted alert this refresh — avoids hash collisions replacing another notify in-batch. */
        int notifySlot = 0;

        for (int i = 0; i < alerts.length(); i++) {
            JSONObject a = alerts.optJSONObject(i);
            if (a == null) continue;

            String key = dedupKey(a);
            if (key.replace("|", "").trim().isEmpty()) continue;

            long expiresMs = parseExpiresMs(a.optString("expires", ""));
            if (expiresMs < now) continue;

            if (notifySlot >= ALERT_NOTIFICATION_ID_RANGE) {
                Log.w(TAG, "Alert notification id band full; skipping remaining alerts");
                break;
            }

            notified.put(key, expiresMs);

            int id = ALERT_NOTIFICATION_ID_BASE + notifySlot;
            notifySlot++;

            String title = firstNonEmpty(a.optString("event", ""), a.optString("headline", ""), "Weather alert");
            String body = buildBody(a);

            Intent tap = new Intent(app, WeatherAlertTapReceiver.class);
            tap.putExtra(WeatherAlertTapReceiver.EXTRA_ALERT_KEY, key);

            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent tapPi = PendingIntent.getBroadcast(app, id, tap, piFlags);

            NotificationCompat.Builder b =
                new NotificationCompat.Builder(app, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_weather_rain)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setContentIntent(tapPi)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            nm.notify("weather_alert_" + id, id, b.build());
            Log.i(TAG, "Scheduled alert notification id=" + id + " key.len=" + key.length());
        }

        WeatherAlertDedupStorage.saveMapJson(app, notified.toString());
    }

    /**
     * WeatherAPI returns {@code alerts.alert} as either one JSON object or an array of objects.
     * {@link JSONArray#optJSONArray} misses the single-object form.
     */
    private static JSONArray coerceAlertsArray(JSONObject alertsWrap) {
        if (alertsWrap == null) return null;
        Object raw = alertsWrap.opt("alert");
        if (raw == null) return null;
        if (raw instanceof JSONArray) return (JSONArray) raw;
        if (raw instanceof JSONObject) {
            JSONArray arr = new JSONArray();
            arr.put((JSONObject) raw);
            return arr;
        }
        return null;
    }

    /** Sorted key\u000bvalue segments — must stay aligned with TS {@code alertCanonicalKvString}. */
    private static String alertCanonicalKvString(JSONObject a) {
        ArrayList<String> keys = new ArrayList<>();
        for (Iterator<String> it = a.keys(); it.hasNext(); ) {
            keys.add(it.next());
        }
        Collections.sort(keys);
        StringBuilder sb = new StringBuilder();
        for (String k : keys) {
            Object v = a.opt(k);
            String vs;
            if (v == null || v == JSONObject.NULL) {
                vs = "";
            } else if (v instanceof String) {
                vs = (String) v;
            } else {
                vs = String.valueOf(v);
            }
            sb.append(k).append('\u000b').append(vs).append('\u000c');
        }
        return sb.toString();
    }

    /** Unsigned DJB2 hex — matches TS {@code djb2UnsignedHex}. */
    private static String djb2RawHex(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        int h = 5381;
        for (int i = 0; i < raw.length(); i++) {
            h = ((h * 33) ^ raw.charAt(i)) | 0;
        }
        long uh = (long) h & 0xffffffffL;
        return Long.toHexString(uh);
    }

    static String dedupKey(JSONObject a) {
        String payloadFp = djb2RawHex(alertCanonicalKvString(a));
        return trim(a.optString("effective", ""))
            + "|"
            + trim(a.optString("expires", ""))
            + "|"
            + trim(a.optString("event", ""))
            + "|"
            + payloadFp;
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    private static String firstNonEmpty(String... parts) {
        for (String p : parts) {
            if (!TextUtils.isEmpty(p)) return p;
        }
        return "Weather alert";
    }

    private static String buildBody(JSONObject a) {
        String headline = trim(a.optString("headline", ""));
        if (!headline.isEmpty()) return headline;
        String desc = trim(a.optString("desc", ""));
        if (!desc.isEmpty()) {
            String oneLine = WS.matcher(desc.trim()).replaceAll(" ");
            return oneLine.length() > 200 ? oneLine.substring(0, 197) + "…" : oneLine;
        }
        String areas = trim(a.optString("areas", ""));
        if (!areas.isEmpty()) return areas;
        return "Tap to view details.";
    }

    /** mirrors TS parseExpires — ISO-ish strings from WeatherAPI */
    private static long parseExpiresMs(String expiresRaw) {
        if (expiresRaw == null || expiresRaw.trim().isEmpty()) {
            return System.currentTimeMillis() + 24L * 3600 * 1000;
        }
        String s = expiresRaw.trim();
        String[] patterns =
            new String[] {
                "yyyy-MM-dd'T'HH:mm:ssXXX",
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "yyyy-MM-dd HH:mm:ss XXX",
                "yyyy-MM-dd HH:mm:ss z",
            };
        for (String p : patterns) {
            try {
                SimpleDateFormat sdf = new SimpleDateFormat(p, Locale.US);
                sdf.setLenient(true);
                return sdf.parse(s).getTime();
            } catch (ParseException ignored) {
            }
        }
        return System.currentTimeMillis() + 24L * 3600 * 1000;
    }
}
