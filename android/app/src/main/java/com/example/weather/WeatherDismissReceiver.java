package com.example.weather;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

/**
 * When the user dismisses the weather notification, kick off a WorkManager job that resolves the
 * current device location and refreshes the notification from WeatherAPI. The receiver itself stays
 * well under the ~10s broadcast-receiver budget so Android can't kill us mid-refresh.
 */
public class WeatherDismissReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();

        // Show a progress notification immediately so the user sees the refresh is in flight.
        WeatherNotificationHelper.showUpdating(app);

        Data input = new Data.Builder()
            .putBoolean(WeatherSyncWorker.INPUT_REFRESH_LOCATION, true)
            .build();

        OneTimeWorkRequest refresh = new OneTimeWorkRequest.Builder(WeatherSyncWorker.class)
            .setInputData(input)
            .build();

        // REPLACE so rapid repeated dismissals just restart the refresh rather than queueing.
        WorkManager.getInstance(app).enqueueUniqueWork(
            WeatherSyncWorker.UNIQUE_DISMISS_REFRESH,
            ExistingWorkPolicy.REPLACE,
            refresh
        );
    }
}
