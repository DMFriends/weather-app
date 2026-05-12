package com.example.weather;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

/**
 * When the user dismisses the weather notification, kick off a WorkManager job that resolves the
 * current device location and refreshes the notification from WeatherAPI. The receiver itself stays
 * well under the ~10s broadcast-receiver budget so Android can't kill us mid-refresh.
 *
 * <p>Guards against stray broadcasts: dismissing another notification (e.g. a weather alert) can
 * still deliver this {@link android.app.PendingIntent} when intents collide. If the ongoing
 * weather notification is still posted for this package, we skip the refresh.
 */
public class WeatherDismissReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();

        NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && isOngoingWeatherNotificationStillPosted(nm, app.getPackageName())) {
            return;
        }

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

    /** True if our foreground weather notification is still visible (user did not dismiss it). */
    private static boolean isOngoingWeatherNotificationStillPosted(NotificationManager nm, String packageName) {
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (!packageName.equals(sbn.getPackageName())) continue;
            if (sbn.getId() != WeatherNotificationHelper.NOTIFICATION_ID) continue;
            if (sbn.getTag() != null) continue;
            return true;
        }
        return false;
    }
}
