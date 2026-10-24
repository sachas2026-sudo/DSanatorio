import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { AppErrorBoundary } from './shared/components/AppErrorBoundary'
import { AuthGate } from './shared/components/AuthGate'
import { AppStateProvider } from './context/AppStateContext'
import { ConfirmProvider } from './context/ConfirmContext'
import { resetAppRouteToInicio } from './lib/appNavigation'
import './index.css'
import App from './App.tsx'

resetAppRouteToInicio()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <HashRouter>
        <ConfirmProvider>
          <AuthGate>
            <AppStateProvider>
              <App />
            </AppStateProvider>
          </AuthGate>
        </ConfirmProvider>
      </HashRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
