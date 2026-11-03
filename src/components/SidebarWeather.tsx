import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { fetchWeather, WEATHER_PLACE_NAME, type WeatherData } from '../lib/weather'

export function SidebarWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let isMounted = true

    const loadWeather = async () => {
      try {
        const data = await fetchWeather()
        if (isMounted) {
          setWeather(data)
        }
      } catch {
        // preserve previous state
      }
    }

    void loadWeather()
    const interval = window.setInterval(loadWeather, 30 * 60 * 1000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const tempDisplay = weather ? `${weather.temp}°` : '--°'
  const maxMinDisplay = weather
    ? `Máx: ${weather.max}° · Mín: ${weather.min}°`
    : 'Máx: --° · Mín: --°'

  return (
    <div
      className="sidebar-weather-row"
      title={weather ? `${weather.temp}°C en ${WEATHER_PLACE_NAME}` : 'Clima'}
    >
      <div className="sidebar-weather-left">
        <svg
          className="sidebar-weather-svg"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--sidebar-weather-icon, #8E9BD6)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
        <div className="sidebar-weather-temp-wrap">
          <span className="sidebar-weather-curr-temp">{tempDisplay}</span>
          <span className="sidebar-weather-range">{maxMinDisplay}</span>
        </div>
      </div>
      <div className="sidebar-weather-right">
        <span className="sidebar-weather-date">{format(now, 'dd-MM-yy')}</span>
        <span className="sidebar-weather-time">{format(now, 'HH:mm')}</span>
      </div>
    </div>
  )
}
