# Weather App

A simple, privacy-friendly weather mobile app powered by [WeatherAPI](https://www.weatherapi.com). Built with [SvelteKit](https://kit.svelte.dev) and wrapped for Android and iOS using [Capacitor](https://capacitorjs.com).

Android builds are available on the [releases page](https://github.com/DMFriends/weather-app/releases/latest). See below for iOS build instructions.

## Features

- **Current conditions at a glance** — temperature (°F), wind speed and direction, and chance of precipitation for right now.
- **72-hour hourly forecast** — horizontally-scrollable strip with temperature and precipitation chance for each hour.
- **10-day daily forecast** — high/low temperatures and daily precipitation chance for the next 10 days.
- **Auto-locate on launch** — on startup the app requests your location and loads the forecast for wherever you are.
- **City search with autocomplete** — type a city name to see live suggestions (keyboard-navigable with arrow keys + Enter).
- **Live GPS tracking** — while the app is open it watches your location and automatically refreshes the forecast when you move more than ~900 m.
- **Offline-friendly cache** — the most recent forecast is stored locally and shown instantly on reopen (fresh for 30 minutes) so you don't wait on the network.
- **Persistent status-bar notification** — shows your current location, temperature, wind, and precipitation chance at a glance.
  - On **Android**, a native background worker refreshes the notification every ~15 minutes, even when the app is closed, and re-posts the notification if you swipe it away.
  - On **iOS**, the notification is kept alive by the app while it's open and is re-posted if dismissed.
- **Graceful fallback** — if location permission is denied or GPS fails, you can still search for any city manually.

## Using the App

### First launch

1. Open the app. You'll be asked to grant **location** and **notification** permissions.
   - **Allow location** to get the forecast for where you are automatically upon opening the app.
   - **Allow notifications all the time** to see the always-on weather notification in your status bar.
   - **Android 12+:** you'll need to grant the app the "Alarms & reminders" permission (it should come up immediately when you first open the app).
2. Once your location is available, the app loads the current conditions, a 72-hour hourly forecast, and a 3-day daily forecast.

### Searching for a different city

1. Tap the **City** input at the top of the screen.
2. Start typing a city name (at least 2 characters). A dropdown list of matching cities will appear.
3. Tap a suggestion — or use the **↑ / ↓** arrow keys and press **Enter** on a connected keyboard — to load that city's forecast.
4. Press **Esc** or tap outside to dismiss the suggestions.

You can also type a free-form query (like `London, UK` or a latitude/longitude such as `40.71,-74.00`) and tap **Get weather**.

### Returning to your location

Tap **Use Current Location** at any time to stop tracking the searched city and switch back to GPS-based local weather.

### Reading the forecast

- **Top card** — current temperature, wind (mph + compass direction + degrees), and precipitation chance for the current hour.
- **Next 72 hours** — scroll horizontally through hour-by-hour temperature and precipitation chance.
- **Next 3 days** — scroll vertically to see daily high/low and precipitation chance for the next 10 days.

### Notification

Once granted permission, the app posts a single persistent notification that shows:

```
<City>
<Temperature> °F · <Wind mph> <Wind dir> · <Precip>% precip
```

On Android, you can dismiss the notification to refresh it with up-to-date weather data based on your current location. **It does not update automatically.**
On iOS, the notification refreshes only when the app is in the foreground.

### Screenshots

You can find screenshots of the app [here](https://github.com/DMFriends/weather-app/tree/main/screenshots) so you can see what it looks like. Feel free to submit feedback by submitting an [issue](https://github.com/DMFriends/weather-app/issues/new)

### Troubleshooting

- **"Location permission denied"** — enable location access for the Weather app in your device settings, then tap **Use Current Location** or relaunch.
- **"Could not get your location"** — you can still type a city into the search box and tap **Get weather**.
- **Notification not updating on Android** — make sure background battery optimizations aren't killing the app; on Android 12+ the app will prompt for the "Alarms & reminders" / exact alarms permission the first time.
- **Stale data on reopen** — the cache is valid for 30 minutes; after that the app fetches a fresh forecast.
- **Submit an [issue](https://github.com/DMFriends/weather-app/issues/new) or [PR](https://github.com/DMFriends/weather-app/pulls)** for any other issues/bugs.

# Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 18+ and npm
- A free API key from [WeatherAPI](https://www.weatherapi.com)

### Configure the API key

Create a `.env` file in the project root with:

```bash
PUBLIC_API_KEY=your_weatherapi_key_here
```

### Install dependencies

```bash
npm install
```

### Run the web app locally

```bash
npm run dev
```

This starts the SvelteKit dev server. The web build supports the same UI but does not include the native persistent notification (that's Android/iOS only).

### Build the static web bundle

```bash
npm run build
```

Capacitor embeds the contents of `build/` into the native apps.

## Building for Android

1. `npm install`
2. `npm run build`
3. `npx cap sync android`
4. `npx cap open android` to open the project in Android Studio, then build/run from there — or run `./gradlew assembleDebug` inside the `android/` folder to produce an APK.

Prebuilt APKs are published under [Releases](https://github.com/DMFriends/weather-app/releases/latest).

## Building for iOS

iOS binaries must be built on **macOS** with **Xcode**. You can develop the web app on any OS; only the native build and App Store upload require a Mac.

### Prerequisites

- **macOS** with [Xcode](https://developer.apple.com/xcode/) installed (includes the iOS SDK and Simulator).
- **Apple Developer Program** membership if you plan to distribute via TestFlight or the App Store, or to run on a physical device with full provisioning.

### One-time setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. If the `ios/` folder is missing (for example on a fresh clone), add the iOS platform:

   ```bash
   npx cap add ios
   ```

### Build and open in Xcode

1. Produce the static web bundle Capacitor embeds in the app:

   ```bash
   npm run build
   ```

2. Copy web assets and plugin changes into the native project:

   ```bash
   npx cap sync ios
   ```

3. Open the iOS project in Xcode:

   ```bash
   npx cap open ios
   ```

### Run and archive in Xcode

1. Select a **Simulator** or a connected **iPhone** as the run destination.
2. In the project settings, set your **Signing & Capabilities** team and ensure the **Bundle Identifier** matches (or updates) the `appId` in `capacitor.config.ts` if you change it.
3. **Run** the app from Xcode to test locally.
4. For TestFlight or the App Store: **Product → Archive**, then use the Organizer to **Distribute App** and upload to App Store Connect.

Repeat `npm run build` and `npx cap sync ios` whenever you change the web app or Capacitor plugins, then rebuild in Xcode.

More detail: [Capacitor iOS documentation](https://capacitorjs.com/docs/ios) and [Development workflow](https://capacitorjs.com/docs/basics/workflow).

## Tech Stack

- **UI / app logic** — [SvelteKit](https://kit.svelte.dev) 2, [Svelte](https://svelte.dev) 5 (runes), TypeScript
- **Native wrapper** — [Capacitor](https://capacitorjs.com) 8 (Android + iOS)
- **Capacitor plugins** — `@capacitor/geolocation`, `@capacitor/local-notifications`
- **Android background refresh** — custom Capacitor plugin (`WeatherNativeNotification`) backed by [WorkManager](https://developer.android.com/topic/libraries/architecture/workmanager) + a dismiss `BroadcastReceiver`
- **Weather data** — [WeatherAPI.com](https://www.weatherapi.com) forecast + search endpoints
