import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoadingScreen } from './components/LoadingScreen'
import { ProtectedRoute } from './components/ProtectedRoute'
import { preloadPdfHeaderBanner } from './lib/pdfHeaderBanner'
import { preloadPdfLogo } from './lib/pdfLogo'

const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage })),
)
const PacientesPage = lazy(() =>
  import('./pages/PacientesPage').then((m) => ({ default: m.PacientesPage })),
)
const MedicosPage = lazy(() =>
  import('./pages/MedicosPage').then((m) => ({ default: m.MedicosPage })),
)
const AgendaPage = lazy(() =>
  import('./pages/AgendaPage').then((m) => ({ default: m.AgendaPage })),
)
const PagosPage = lazy(() =>
  import('./pages/PagosPage').then((m) => ({ default: m.PagosPage })),
)
const PagosCanceladosPage = lazy(() =>
  import('./pages/PagosCanceladosPage').then((m) => ({
    default: m.PagosCanceladosPage,
  })),
)
const ConfiguracionPage = lazy(() =>
  import('./pages/ConfiguracionPage').then((m) => ({
    default: m.ConfiguracionPage,
  })),
)

export default function App() {
  useEffect(() => {
    void preloadPdfLogo()
    void preloadPdfHeaderBanner()
  }, [])

  return (
    <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="pacientes" element={<PacientesPage />} />
            <Route path="medicos" element={<MedicosPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route
              path="pagos"
              element={
                <ProtectedRoute path="/pagos">
                  <PagosPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="pagos-cancelados"
              element={
                <ProtectedRoute path="/pagos-cancelados">
                  <PagosCanceladosPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="configuracion"
              element={
                <ProtectedRoute path="/configuracion">
                  <ConfiguracionPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
  )
}
