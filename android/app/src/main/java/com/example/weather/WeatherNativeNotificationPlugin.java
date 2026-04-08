package com.example.weather;

import static android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WeatherNativeNotification")
public class WeatherNativeNotificationPlugin extends Plugin {

    private static final String PREFS = "weather_native_notification";
    private static final String KEY_API = "api_key";
    private static final String KEY_QUERY = "query_q";

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
        prefs.edit().putString(KEY_API, apiKey).putString(KEY_QUERY, query).apply();

        // Update immediately using the in-app payload (so it matches the UI),
        // then rely on alarms to refresh in the background.
        if (title != null && body != null) {
            WeatherNotificationHelper.show(ctx, title, body);
        }
        WeatherAlarmScheduler.cancel(ctx);
        WeatherAlarmScheduler.scheduleNext(ctx);
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
            // Opens system UI where the user can allow exact alarms for this app.
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
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }
}
