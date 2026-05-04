export type WeatherApiForecastHour = {
  time_epoch: number;
  temp_f: number;
  chance_of_rain: number;
  chance_of_snow: number;
  wind_mph: number;
  wind_dir: string;
};

export type WeatherApiForecastDay = {
  date: string;
  date_epoch: number;
  day: {
    maxtemp_f: number;
    mintemp_f: number;
    daily_chance_of_rain: number;
    daily_chance_of_snow: number;
    maxwind_mph: number;
  };
  hour: WeatherApiForecastHour[];
};

export type WeatherApiAlert = {
  headline?: string;
  msgtype?: string;
  severity?: string;
  urgency?: string;
  areas?: string;
  category?: string;
  certainty?: string;
  event?: string;
  note?: string;
  effective?: string;
  expires?: string;
  desc?: string;
  instruction?: string;
};

export type WeatherApiResponse = {
  location: {
    name: string;
    lat: number;
    lon: number;
  };
  current: {
    last_updated_epoch: number;
    temp_f: number;
    wind_mph: number;
    wind_dir: string;
    wind_degree: number;
  };
  forecast: {
    forecastday: WeatherApiForecastDay[];
  };
  alerts?: {
    alert?: WeatherApiAlert[];
  };
};

export type HourlyForecast = {
  timeEpoch: number;
  label: string;
  dateLabel: string;
  tempF: number;
  precipChancePct: number;
  windMph: number;
  windDir: string;
};

export type DailyForecast = {
  dateEpoch: number;
  label: string;
  highF: number;
  lowF: number;
  precipChancePct: number;
  maxWindMph: number;
  maxWindDir: string;
};

export type TempUnit = "F" | "C";

export const TEMP_UNIT_STORAGE_KEY = "weather-app:tempUnit";

export function loadInitialTempUnit(): TempUnit {
  if (typeof localStorage === "undefined") return "F";
  const stored = localStorage.getItem(TEMP_UNIT_STORAGE_KEY);
  return stored === "C" ? "C" : "F";
}

export function fToC(f: number) {
  return (f - 32) * (5 / 9);
}

export function formatTemp(tempF: number, unit: TempUnit) {
  const value = unit === "C" ? fToC(tempF) : tempF;
  return `${Math.round(value)} °${unit}`;
}

export function formatTempPrecise(tempF: number, unit: TempUnit) {
  const value = unit === "C" ? fToC(tempF) : tempF;
  return `${value.toFixed(1)} °${unit}`;
}

export function clampPct(n: unknown) {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function precipChanceFromRainSnow(rainPct: unknown, snowPct: unknown) {
  return Math.max(clampPct(rainPct), clampPct(snowPct));
}

export function formatHourLabel(timeEpochSeconds: number) {
  return new Date(timeEpochSeconds * 1000).toLocaleTimeString([], { hour: "numeric" });
}

export function formatHourDateLabel(timeEpochSeconds: number) {
  return new Date(timeEpochSeconds * 1000).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDayLabel(dateEpochSeconds: number) {
  return new Date(dateEpochSeconds * 1000).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * WeatherAPI's `forecastday[].date_epoch` is midnight UTC for the given
 * calendar date, so formatting it via `toLocaleDateString` in any timezone
 * west of UTC shifts the label back by one day. Parsing the `date` string
 * (e.g. "2026-04-26") as local midnight avoids that drift entirely.
 */
export function parseLocalMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map((s) => Number.parseInt(s, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDayLabelFromDate(dateStr: string) {
  return parseLocalMidnight(dateStr).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Each API hour row covers [time_epoch, time_epoch + 1h); keep slots that still apply to now or the future. */
export function hourlySlotsFromNow(allHours: WeatherApiForecastHour[], nowSec: number) {
  return allHours.filter((h) => h.time_epoch + 3600 > nowSec);
}

export function buildHourly(resp: WeatherApiResponse, limit = 72): HourlyForecast[] {
  const forecastDays = resp.forecast?.forecastday ?? [];
  const allHours = forecastDays.flatMap((d) => d.hour ?? []);
  const nowSec = Math.floor(Date.now() / 1000);
  const relevantHours = hourlySlotsFromNow(allHours, nowSec);
  const hoursForUi = relevantHours.length ? relevantHours : allHours;

  return hoursForUi.slice(0, limit).map((h) => ({
    timeEpoch: h.time_epoch,
    label: formatHourLabel(h.time_epoch),
    dateLabel: formatHourDateLabel(h.time_epoch),
    tempF: h.temp_f,
    precipChancePct: precipChanceFromRainSnow(h.chance_of_rain, h.chance_of_snow),
    windMph: typeof h.wind_mph === "number" ? h.wind_mph : 0,
    windDir: typeof h.wind_dir === "string" ? h.wind_dir : "",
  }));
}

export function buildDaily(resp: WeatherApiResponse, limit = 10): DailyForecast[] {
  const forecastDays = resp.forecast?.forecastday ?? [];
  return forecastDays.slice(0, limit).map((d) => {
    const hours = d.hour ?? [];
    let maxWindDir = "";
    let peakMph = -Infinity;
    for (const h of hours) {
      const mph = typeof h.wind_mph === "number" ? h.wind_mph : -Infinity;
      if (mph > peakMph) {
        peakMph = mph;
        maxWindDir = typeof h.wind_dir === "string" ? h.wind_dir : "";
      }
    }
    const localMidnightSec = d.date
      ? Math.floor(parseLocalMidnight(d.date).getTime() / 1000)
      : d.date_epoch;
    return {
      dateEpoch: localMidnightSec,
      label: d.date ? formatDayLabelFromDate(d.date) : formatDayLabel(d.date_epoch),
      highF: d.day.maxtemp_f,
      lowF: d.day.mintemp_f,
      precipChancePct: precipChanceFromRainSnow(d.day.daily_chance_of_rain, d.day.daily_chance_of_snow),
      maxWindMph: typeof d.day.maxwind_mph === "number" ? d.day.maxwind_mph : 0,
      maxWindDir,
    };
  });
}

export function currentPrecipChanceFromHourly(
  hourly: HourlyForecast[],
  currentEpochSec: number | undefined
): number | null {
  if (typeof currentEpochSec !== "number" || !hourly.length) return null;
  let best = hourly[0];
  let bestDist = Math.abs(best.timeEpoch - currentEpochSec);
  for (const h of hourly) {
    const dist = Math.abs(h.timeEpoch - currentEpochSec);
    if (dist < bestDist) {
      best = h;
      bestDist = dist;
    }
  }
  return best.precipChancePct;
}

export function getAlerts(resp: WeatherApiResponse | null | undefined): WeatherApiAlert[] {
  return resp?.alerts?.alert ?? [];
}

/** Stable key for the same logical alert across refreshes (notifications, deep links). */
export function weatherAlertDedupKey(a: WeatherApiAlert): string {
  return [a.event, a.headline, a.effective, a.expires]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .join("|");
}
