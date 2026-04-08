# Weather App

A simple weather mobile app which uses data from the [WeatherAPI](https://www.weatherapi.com). Supported on both Android and iOS.
Android builds can be found [here](https://github.com/DMFriends/weather-app/releases). See instructions below for building the app for iOS.

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
