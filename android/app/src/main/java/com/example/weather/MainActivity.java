package com.example.weather;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WeatherNativeNotificationPlugin.class);
        registerPlugin(BackgroundLocationPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
