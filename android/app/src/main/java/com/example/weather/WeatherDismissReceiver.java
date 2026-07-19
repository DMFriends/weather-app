package com.example.weather;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/**
 * When the user dismisses the weather notification, kick off a WorkManager job that resolves the
 * current device location and refreshes the notification from WeatherAPI. The receiver itself stays
 * well under the ~10s broadcast-receiver budget so Android can't kill us mid-refresh.
 *
 * <p>Guards against stray broadcasts: dismissing another notification (e.g. a weather alert) can
 * still deliver this {@link android.app.PendingIntent} when intents collide. If the ongoing
 * weather notification is still posted for this package, we skip the refresh.
 *
 * <p>Also guards against dismissals the user did not perform on this device. Since Android 14,
 * {@code setOngoing(true)} no longer exempts a notification from being swiped or swept up by
 * "Clear all", so this delete intent can fire from a paired watch, Android Auto, or an OEM
 * battery/cleaner routine — typically while the screen is off or the device is locked. A deliberate
 * swipe effectively always happens with the screen on and unlocked, so anything else is treated as
 * spurious: the notification is silently restored from cache and no refresh is run.
 */
public class WeatherDismissReceiver extends BroadcastReceiver {

    private static final String TAG = "WeatherDismissReceiver";

    /** Fires just after the "Updating…" notification's own timeout, so it only sees genuinely stuck refreshes. */
    private static final long WATCHDOG_DELAY_SECONDS = 90L;

    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();

        NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && isOngoingWeatherNotificationStillPosted(nm, app.getPackageName())) {
            return;
        }

        if (!isUserPresent(app)) {
            // Not a swipe the user made here: put the notification back with cached text and skip
            // the location + network refresh entirely.
            Log.i(TAG, "dismiss while screen off/locked; treating as spurious, restoring notification");
            WeatherNotificationHelper.showPersistedIfAvailable(app);
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

        // Backstop in case the refresh above never completes (process killed, job never scheduled).
        // WeatherSyncWorker cancels this as soon as it settles either way.
        OneTimeWorkRequest watchdog = new OneTimeWorkRequest.Builder(WeatherRefreshWatchdogWorker.class)
            .setInitialDelay(WATCHDOG_DELAY_SECONDS, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(app).enqueueUniqueWork(
            WeatherRefreshWatchdogWorker.UNIQUE_WATCHDOG,
            ExistingWorkPolicy.REPLACE,
            watchdog
        );
    }

    /**
     * True if the user could plausibly have just swiped the notification themselves: screen on and
     * device unlocked. Dismissals propagated from a paired watch, or issued by a cleaner routine,
     * usually arrive with the screen off or the keyguard up.
     */
    private static boolean isUserPresent(Context app) {
        PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) return false;

        KeyguardManager km = (KeyguardManager) app.getSystemService(Context.KEYGUARD_SERVICE);
        if (km != null && km.isKeyguardLocked()) return false;

        return true;
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
