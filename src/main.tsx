import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { isTauri } from '@tauri-apps/api/core'
import { AppErrorBoundary } from './shared/components/AppErrorBoundary'
import { AuthGate } from './shared/components/AuthGate'
import { AppStateProvider } from './context/AppStateContext'
import { ConfirmProvider } from './context/ConfirmContext'
import { WindowMinimizeButton } from './shared/components/WindowMinimizeButton'
import { resetAppRouteToInicio } from './lib/appNavigation'
import './index.css'
import App from './App.tsx'

resetAppRouteToInicio()

if (isTauri()) {
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.maximize()
      await win.setFocus()
    } catch {
      // ignore
    }
  })()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <WindowMinimizeButton />
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
