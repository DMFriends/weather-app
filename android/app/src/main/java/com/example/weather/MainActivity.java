package com.example.weather;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WeatherNativeNotificationPlugin.class);
        registerPlugin(WeatherAlertDedupPlugin.class);
        registerPlugin(BackgroundLocationPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Foreground state is tracked here rather than pushed down from JS because the paths that need
    // it run in a BroadcastReceiver/Worker with no WebView attached (see WeatherAlertNotifier), and
    // because Android pauses the WebView on background — JS scheduled at that moment may never run.
    //
    // onStart/onStop (visibility) rather than onResume/onPause: leaving the app while it stays in
    // recents is exactly onStop, whereas onPause also fires for permission dialogs. Pulling down the
    // notification shade triggers neither, so swiping the weather notification while the app is open
    // still correctly reads as foreground.

    @Override
    public void onStart() {
        super.onStart();
        WeatherNotificationHelper.setAppForeground(this, true);
        // Fresh session: nothing has been read in the app yet.
        WeatherAlertNotifier.clearAlertsPageOpened(this);
    }

    @Override
    public void onStop() {
        WeatherNotificationHelper.setAppForeground(this, false);
        // User has left the app — release anything held back while they were looking at it.
        WeatherAlertNotifier.postPendingIfAny(this);
        super.onStop();
    }
}
