import { PUBLIC_API_KEY } from "$env/static/public";
import type { WeatherApiAlert, WeatherApiResponse } from "$lib/forecast";

type NwsAlertFeature = {
  id?: string;
  properties?: {
    id?: string;
    areaDesc?: string;
    headline?: string;
    messageType?: string;
    severity?: string;
    urgency?: string;
    category?: string | string[];
    certainty?: string;
    event?: string;
    effective?: string;
    expires?: string;
    description?: string;
    instruction?: string;
  };
};

function isUnitedStatesLocation(resp: WeatherApiResponse): boolean {
  const country = resp.location?.country?.trim().toUpperCase() ?? "";
  return country === "US" || country === "USA" || country.includes("UNITED STATES");
}

function normalizeNwsCategory(category: string | string[] | undefined): string | undefined {
  if (Array.isArray(category)) return category.filter(Boolean).join(",");
  return category;
}

function nwsFeatureToWeatherApiAlert(feature: NwsAlertFeature): WeatherApiAlert | null {
  const p = feature.properties;
  if (!p) return null;
  return {
    identifier: p.id ?? feature.id,
    headline: p.headline,
    msgtype: p.messageType,
    severity: p.severity,
    urgency: p.urgency,
    areas: p.areaDesc,
    category: normalizeNwsCategory(p.category),
    certainty: p.certainty,
    event: p.event,
    effective: p.effective,
    expires: p.expires,
    desc: p.description,
    instruction: p.instruction,
  };
}

async function fetchNwsAlertsForPoint(lat: number, lon: number): Promise<WeatherApiAlert[]> {
  const res = await fetch(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    {
      headers: {
        Accept: "application/geo+json",
      },
    },
  );
  if (!res.ok) throw new Error(`NWS alerts unavailable (${res.status})`);
  const json = (await res.json()) as { features?: NwsAlertFeature[] };
  return (json.features ?? [])
    .map(nwsFeatureToWeatherApiAlert)
    .filter((a): a is WeatherApiAlert => a != null);
}

async function replaceUsAlertsWithPointAlerts(resp: WeatherApiResponse): Promise<WeatherApiResponse> {
  const lat = resp.location?.lat;
  const lon = resp.location?.lon;
  if (!isUnitedStatesLocation(resp) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return resp;
  }

  try {
    const pointAlerts = await fetchNwsAlertsForPoint(lat, lon);
    return {
      ...resp,
      alerts: {
        ...resp.alerts,
        alert: pointAlerts,
      },
    };
  } catch (e) {
    console.warn("NWS point alerts unavailable; using WeatherAPI alerts", e);
    return resp;
  }
}

export async function fetchWeatherForecast(q: string): Promise<WeatherApiResponse> {
  const res = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${PUBLIC_API_KEY}&q=${encodeURIComponent(q)}&days=10&aqi=no&alerts=yes`,
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || "API error");
  }
  return replaceUsAlertsWithPointAlerts(json as WeatherApiResponse);
}
