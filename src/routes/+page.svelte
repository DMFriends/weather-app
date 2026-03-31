<script lang="ts">
    import { Geolocation } from '@capacitor/geolocation';
    import { PUBLIC_OPENWEATHER_API_KEY } from '$env/static/public';

    type WeatherData = {
        name: string;
        weather: { description: string }[];
        main: { temp: number };
        wind: { speed: number };
    };

    let city = $state("");
    let weather: WeatherData | null = $state(null);
    let error = $state("");

    async function fetchWeather() {
        error = "";
        weather = null;

        try {
            const res = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&appid=${PUBLIC_OPENWEATHER_API_KEY}`
            );

            const data = await res.json();

            console.log(data);

            if (!res.ok) {
                throw new Error(data.message || "API error");
            }

            weather = data;
        } catch (e: any) {
            error = e.message;
            console.error(e);
        }
    }

    export async function getCurrentLocationWeather() {
        const pos = await Geolocation.getCurrentPosition();

        const { latitude, longitude } = pos.coords;

        const res = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${PUBLIC_OPENWEATHER_API_KEY}&units=metric`
        );

        return res.json();
    }
</script>

<main>
  <h1>Weather App</h1>

  <input
    placeholder="Enter city"
    bind:value={city}
  />

  <button onclick={fetchWeather}>
    Get Weather
  </button>

  {#if error}
    <p style="color:red">{error}</p>
  {/if}

  {#if weather}
    <div class="card">
      <h2>{weather.name}</h2>
      <p>{weather.weather[0].description}</p>
      <p>🌡️ {weather.main.temp} °C</p>
      <p>💨 {weather.wind.speed} m/s</p>
    </div>
  {/if}
</main>

<style>
  main {
    padding: 2rem;
    font-family: sans-serif;
    text-align: center;
  }

  input {
    padding: 0.5rem;
    margin: 0.5rem;
  }

  button {
    padding: 0.5rem 1rem;
  }

  .card {
    margin-top: 1rem;
    padding: 1rem;
    border-radius: 12px;
    background: #f3f3f3;
  }
</style>