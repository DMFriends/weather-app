package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Legacy: previously chained 15-minute refresh alarms. Clears any still-scheduled alarm and does nothing else.
 */
public class WeatherAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        WeatherAlarmScheduler.cancel(context.getApplicationContext());
    }
}
