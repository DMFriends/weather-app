package com.example.weather;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Backstop for a swipe-refresh that never finishes. {@link WeatherSyncWorker} clears the "Updating…"
 * spinner and posts an error in its own {@code finally}, but that cleanup is lost entirely if the
 * process is killed mid-refresh or the refresh job never gets scheduled (Doze, app standby, OEM
 * battery killers) — leaving the spinner up and, because the user swiped the real notification away
 * to trigger the refresh, no weather notification at all.
 *
 * <p>This runs on a delay just past {@code UPDATING_TIMEOUT_MS} and repairs that state. It is
 * enqueued through WorkManager rather than held in memory precisely so it survives process death,
 * and {@link WeatherSyncWorker} cancels it once the refresh actually settles.
 */
public class WeatherRefreshWatchdogWorker extends Worker {

    private static final String TAG = "WeatherRefreshWatchdog";

    public static final String UNIQUE_WATCHDOG = "weather_refresh_watchdog";

    public WeatherRefreshWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context app = getApplicationContext();

        WeatherNotificationHelper.cancelUpdating(app);

        if (WeatherNotificationHelper.isWeatherNotificationPosted(app)) {
            // Refresh completed and posted after all; nothing stranded.
            return Result.success();
        }

        Log.w(TAG, "refresh never settled; restoring weather notification");
        if (!WeatherNotificationHelper.showPersistedIfAvailable(app)) {
            WeatherNotificationHelper.showError(
                app,
                "Weather update failed",
                "Couldn't refresh the weather. Tap to open, or swipe to retry.");
        }
        return Result.success();
    }
}
