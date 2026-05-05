package com.example.weather;

import static android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "WeatherNativeNotification")
public class WeatherNativeNotificationPlugin extends Plugin {

    private static final String PREFS = "weather_native_notification";
    private static final String KEY_API = "api_key";
    private static final String KEY_QUERY = "query_q";
    private static final String KEY_LAST_TITLE = WeatherNotificationHelper.KEY_LAST_TITLE;
    private static final String KEY_LAST_BODY = WeatherNotificationHelper.KEY_LAST_BODY;

    @PluginMethod
    public void sync(PluginCall call) {
        String apiKey = call.getString("apiKey", "");
        String query = call.getString("query", "");
        String title = call.getString("title", null);
        String body = call.getString("body", null);
        if (apiKey.isEmpty() || query.isEmpty()) {
            call.reject("apiKey and query are required");
            return;
        }

        Context ctx = getContext().getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = prefs.edit().putString(KEY_API, apiKey).putString(KEY_QUERY, query);
        boolean hasDisplay =
            title != null
                && body != null
                && !title.trim().isEmpty()
                && !body.trim().isEmpty();
        if (hasDisplay) {
            ed.putString(KEY_LAST_TITLE, title).putString(KEY_LAST_BODY, body);
        }
        ed.apply();

        WeatherAlarmScheduler.cancel(ctx);
        WorkManager.getInstance(ctx).cancelUniqueWork(WeatherSyncWorker.UNIQUE_PERIODIC);

        if (hasDisplay) {
            WeatherNotificationHelper.show(ctx, title, body);
        }
        call.resolve();
    }

    /**
     * Consumes a pending alert dedup key written when the user tapped a native-scheduled alert
     * notification ({@link WeatherAlertNotifier}), so JS can navigate to /alerts.
     */
    @PluginMethod
    public void consumePendingAlertKey(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        String key = WeatherPendingAlertNavigation.consumePendingAlertKey(ctx);
        JSObject ret = new JSObject();
        if (key != null && !key.isEmpty()) {
            ret.put("key", key);
        }
        call.resolve(ret);
    }

    /** Cancels OS notifications in the weather-alert id band ({@link WeatherAlertNotifier}). */
    @PluginMethod
    public void cancelWeatherAlertNotifications(PluginCall call) {
        WeatherAlertNotifier.cancelAllScheduledAlertNotifications(getContext().getApplicationContext());
        call.resolve();
    }

    /**
     * Posts alert notifications from the same JSON shape as WeatherAPI forecast root ({@code location},
     * {@code alerts.alert}), matching {@link WeatherSyncWorker}. Avoids duplicating notifications from
     * Capacitor LocalNotifications (different Android tags).
     */
    @PluginMethod
    public void scheduleWeatherAlertsFromForecastJson(PluginCall call) {
        String json = call.getString("forecastJson", "{}");
        try {
            JSONObject root = new JSONObject(json);
            WeatherAlertNotifier.scheduleFromForecastRoot(getContext().getApplicationContext(), root);
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid forecast JSON for alerts", e);
        }
    }

    /** Hide the notification without wiping API key / query (used while reloading forecast). */
    @PluginMethod
    public void cancelDisplay(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        WeatherNotificationHelper.cancel(ctx);
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().remove(KEY_LAST_TITLE).remove(KEY_LAST_BODY).apply();
        call.resolve();
    }

    @PluginMethod
    public void requestExactAlarms(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.resolve();
            return;
        }
        try {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            if (am != null && am.canScheduleExactAlarms()) {
                call.resolve();
                return;
            }
            Intent i = new Intent(ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            i.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(i);
        } catch (Exception e) {
            // ignore
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        WeatherAlarmScheduler.cancel(ctx);
        WeatherNotificationHelper.cancel(ctx);
        WorkManager.getInstance(ctx).cancelUniqueWork(WeatherSyncWorker.UNIQUE_PERIODIC);
        WeatherAlertDedupStorage.clearAll(ctx);
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }
}
