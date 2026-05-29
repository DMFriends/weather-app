import { PUBLIC_API_KEY } from "$env/static/public";
import type { WeatherApiResponse } from "$lib/forecast";

export async function fetchWeatherForecast(q: string): Promise<WeatherApiResponse> {
  const res = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${PUBLIC_API_KEY}&q=${encodeURIComponent(q)}&days=10&aqi=no&alerts=yes`,
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || "API error");
  }
  return json as WeatherApiResponse;
}
