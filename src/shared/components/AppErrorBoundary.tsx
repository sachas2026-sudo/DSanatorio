import { Component, type ErrorInfo, type ReactNode } from 'react'
import { resetAppRouteToInicio } from '../../lib/appNavigation'
import './app-error.css'

type Props = { children: ReactNode }

type State = { error: Error | null }

/** Evita pantalla en blanco si falla un componente al renderizar. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error en la interfaz:', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoInicio = () => {
    resetAppRouteToInicio()
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error" role="alert">
          <div className="app-error__card">
            <h1 className="app-error__title">No se pudo mostrar la pantalla</h1>
            <p className="app-error__message">{this.state.error.message}</p>
            <p className="app-error__hint">
              Podés reintentar o volver a Inicio. Si el problema sigue, restaurá
              un respaldo desde Configuración.
            </p>
            <div className="app-error__actions">
              <button
                type="button"
                className="app-error__btn app-error__btn--primary"
                onClick={this.handleReload}
              >
                Reintentar
              </button>
              <button
                type="button"
                className="app-error__btn app-error__btn--ghost"
                onClick={this.handleGoInicio}
              >
                Volver a Inicio
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
