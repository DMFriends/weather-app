package com.example.weather;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Android Q+: optional ACCESS_BACKGROUND_LOCATION so WorkManager can resolve GPS when inactive. */
@CapacitorPlugin(
        name = "BackgroundLocationPermission",
        permissions =
                {@Permission(
                        strings = {Manifest.permission.ACCESS_BACKGROUND_LOCATION},
                        alias = "backgroundLocation")})
public final class BackgroundLocationPermissionPlugin extends Plugin {

    static final String PERMISSION_BACKGROUND_LOCATION = "backgroundLocation";

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            out.put("supported", false);
            out.put("foregroundGranted", true);
            out.put("backgroundGranted", true);
            call.resolve(out);
            return;
        }
        boolean fg = hasForegroundLocation();
        boolean bg = getPermissionState(PERMISSION_BACKGROUND_LOCATION) == PermissionState.GRANTED;
        out.put("supported", true);
        out.put("foregroundGranted", fg);
        out.put("backgroundGranted", bg);
        call.resolve(out);
    }

    @PluginMethod
    public void requestIfNeeded(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        if (!hasForegroundLocation()) {
            call.reject("foreground_not_granted", "Grant location access first (while using the app).");
            return;
        }
        if (getPermissionState(PERMISSION_BACKGROUND_LOCATION) == PermissionState.GRANTED) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        requestPermissionForAliases(new String[] {PERMISSION_BACKGROUND_LOCATION}, call, "finishRequestIfNeeded");
    }

    @PermissionCallback
    private void finishRequestIfNeeded(PluginCall call) {
        JSObject out = new JSObject();
        out.put(
                "granted",
                getPermissionState(PERMISSION_BACKGROUND_LOCATION) == PermissionState.GRANTED);
        call.resolve(out);
    }

    private boolean hasForegroundLocation() {
        boolean fine =
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        boolean coarse =
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }
}
