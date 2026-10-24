import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { fetchWeather, getWeatherIcon, WEATHER_PLACE_NAME, type WeatherData } from '../../lib/weather'

export function SidebarWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let isMounted = true

    const loadWeather = async () => {
      try {
        const data = await fetchWeather()
        if (isMounted) {
          setWeather(data)
          setError(false)
        }
      } catch {
        if (isMounted) {
          setError(true)
        }
      }
    }

    void loadWeather()

    // Refresh weather every 30 minutes
    const interval = window.setInterval(() => {
      void loadWeather()
    }, 30 * 60 * 1000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (error || !weather) return null

  return (
    <div className="sidebar-weather" title={`${weather.temp}°C en ${WEATHER_PLACE_NAME}`}>
      <span className="sidebar-weather__icon">{getWeatherIcon(weather.weatherCode)}</span>
      <div className="sidebar-weather__content">
        <div className="sidebar-weather__info">
          <p className="sidebar-weather__temp">{weather.temp}°</p>
          <p className="sidebar-weather__range">
            <span className="sidebar-weather__label">Máx:</span> {weather.max}°
          </p>
          <p className="sidebar-weather__range">
            <span className="sidebar-weather__label">Mín:</span> {weather.min}°
          </p>
        </div>
        <div className="sidebar-weather__datetime">
          <span className="sidebar-weather__date">{format(now, 'dd-MM-yy')}</span>
          <span className="sidebar-weather__time">{format(now, 'HH:mm')}</span>
        </div>
      </div>
    </div>
  )
}
