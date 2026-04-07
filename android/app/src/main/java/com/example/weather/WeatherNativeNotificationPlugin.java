package com.example.weather;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.work.WorkManager;

@CapacitorPlugin(name = "WeatherNativeNotification")
public class WeatherNativeNotificationPlugin extends Plugin {

    private static final String PREFS = "weather_native_notification";
    private static final String KEY_API = "api_key";
    private static final String KEY_QUERY = "query_q";

    @PluginMethod
    public void sync(PluginCall call) {
        String apiKey = call.getString("apiKey", "");
        String query = call.getString("query", "");
        if (apiKey.isEmpty() || query.isEmpty()) {
            call.reject("apiKey and query are required");
            return;
        }

        Context ctx = getContext().getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_API, apiKey).putString(KEY_QUERY, query).apply();

        WeatherSyncWorker.runOnce(ctx);
        WeatherSyncWorker.schedulePeriodic(ctx);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        WorkManager.getInstance(ctx).cancelAllWork();
        WeatherNotificationHelper.cancel(ctx);
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }
}
