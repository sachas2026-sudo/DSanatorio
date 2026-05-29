// Weather API integration using Open-Meteo (free, no API key required)
// Location: Puerto Piray, Misiones, Argentina

export interface WeatherData {
  temp: number
  weatherCode: number
  max: number
  min: number
}

const WEATHER_LAT = -26.4667
const WEATHER_LON = -54.7167
const WEATHER_PLACE = 'Puerto Piray, Misiones'

export async function fetchWeather(): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(WEATHER_LAT))
  url.searchParams.set('longitude', String(WEATHER_LON))
  url.searchParams.set('current', 'temperature_2m,weather_code')
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min')
  url.searchParams.set('temperature_unit', 'celsius')
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error('Failed to fetch weather data')

  const data = (await response.json()) as {
    current: {
      temperature_2m: number
      weather_code: number
    }
    daily: {
      temperature_2m_max: number[]
      temperature_2m_min: number[]
    }
  }

  return {
    temp: Math.round(data.current.temperature_2m),
    weatherCode: data.current.weather_code,
    max: Math.round(data.daily.temperature_2m_max[0]),
    min: Math.round(data.daily.temperature_2m_min[0]),
  }
}

export function getWeatherIcon(code: number): string {
  // Based on WMO Weather interpretation codes
  if (code === 0) return '☀️'
  if (code === 1 || code === 2) return '⛅'
  if (code === 3 || code === 45 || code === 48) return '☁️'
  if (code >= 51 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌧️'
  if (code >= 85 && code <= 86) return '❄️'
  if (code >= 95 && code <= 99) return '⛈️'
  return '🌡️'
}

export const WEATHER_PLACE_NAME = WEATHER_PLACE
