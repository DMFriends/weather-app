import { PUBLIC_API_KEY } from '$env/static/public';

export async function getWeather(city: string) {
  const res = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${PUBLIC_API_KEY}&q=${city}&days=7&aqi=no&alerts=no`
  );

  if (!res.ok) {
    throw new Error("Failed to fetch weather");
  }

  return res.json();
}