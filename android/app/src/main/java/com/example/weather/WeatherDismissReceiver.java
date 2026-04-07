package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

/**
 * When the user dismisses the weather notification, re-fetch and show it again (even if the app is not open).
 */
public class WeatherDismissReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(WeatherSyncWorker.class).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueue(work);
    }
}
