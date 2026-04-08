import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.weather',
  appName: 'Weather',
  webDir: 'build',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_weather_rain',
    },
  },
};

export default config;
