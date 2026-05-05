package com.example.weather;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WeatherAlertDedup")
public class WeatherAlertDedupPlugin extends Plugin {

    @PluginMethod
    public void loadNotifiedMap(PluginCall call) {
        Context ctx = getContext().getApplicationContext();
        JSObject ret = new JSObject();
        ret.put("json", WeatherAlertDedupStorage.loadMapJson(ctx));
        call.resolve(ret);
    }

    @PluginMethod
    public void saveNotifiedMap(PluginCall call) {
        String json = call.getString("json", "{}");
        WeatherAlertDedupStorage.saveMapJson(getContext().getApplicationContext(), json);
        call.resolve();
    }

    @PluginMethod
    public void clearNotifiedMap(PluginCall call) {
        WeatherAlertDedupStorage.clearMap(getContext().getApplicationContext());
        call.resolve();
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        WeatherAlertDedupStorage.clearAll(getContext().getApplicationContext());
        call.resolve();
    }

    @PluginMethod
    public void maybeClearDedupForLocation(PluginCall call) {
        double lat = call.getDouble("lat", Double.NaN);
        double lon = call.getDouble("lon", Double.NaN);
        if (Double.isNaN(lat) || Double.isNaN(lon)) {
            call.reject("lat and lon are required");
            return;
        }
        WeatherAlertDedupStorage.maybeClearDedupForLocation(getContext().getApplicationContext(), lat, lon);
        call.resolve();
    }
}
