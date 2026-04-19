package com.example.weather;

import static android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.work.WorkManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }
}
