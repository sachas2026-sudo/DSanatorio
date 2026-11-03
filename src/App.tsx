import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './shared/components/Layout'
import { LoadingScreen } from './shared/components/LoadingScreen'
import { ProtectedRoute } from './shared/components/ProtectedRoute'
import { useAuthSession } from './context/AuthContext'
import { preloadPdfHeaderBanner } from './lib/pdfHeaderBanner'
import { preloadPdfLogo } from './lib/pdfLogo'

const HomePage = lazy(() =>
  import('./shared/components/HomePage').then((m) => ({ default: m.HomePage })),
)
const PacientesPage = lazy(() =>
  import('./modules/pacientes/pages/PacientesPage').then((m) => ({ default: m.PacientesPage })),
)
const MedicosPage = lazy(() =>
  import('./modules/medicos/pages/MedicosPage').then((m) => ({ default: m.MedicosPage })),
)
const AgendaPage = lazy(() =>
  import('./modules/agenda/pages/AgendaPage').then((m) => ({ default: m.AgendaPage })),
)
const PagosPage = lazy(() =>
  import('./modules/pagos/pages/PagosPage').then((m) => ({ default: m.PagosPage })),
)
const PagosCanceladosPage = lazy(() =>
  import('./modules/pagos/pages/PagosCanceladosPage').then((m) => ({
    default: m.PagosCanceladosPage,
  })),
)
const ConfiguracionPage = lazy(() =>
  import('./modules/configuracion/pages/ConfiguracionPage').then((m) => ({
    default: m.ConfiguracionPage,
  })),
)
const MantenimientoPage = lazy(() =>
  import('./modules/configuracion/pages/MantenimientoPage').then((m) => ({
    default: m.MantenimientoPage,
  })),
)
const AfiliadosPage = lazy(() =>
  import('./modules/afiliados/pages/AfiliadosPage').then((m) => ({ default: m.AfiliadosPage })),
)

/** Inicio: el afiliado no tiene dashboard, va directo a su módulo. */
function IndexRoute() {
  const { session } = useAuthSession()
  if (session?.role === 'afiliado') {
    return <Navigate to="/afiliados" replace />
  }
  return <HomePage />
}

export default function App() {
  useEffect(() => {
    void preloadPdfLogo()
    void preloadPdfHeaderBanner()
  }, [])

  return (
    <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<IndexRoute />} />
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
            <Route
              path="backup"
              element={
                <ProtectedRoute path="/backup">
                  <ConfiguracionPage backupOnly />
                </ProtectedRoute>
              }
            />
            <Route
              path="mantenimiento"
              element={
                <ProtectedRoute path="/mantenimiento">
                  <MantenimientoPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="afiliados"
              element={
                <ProtectedRoute path="/afiliados">
                  <AfiliadosPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
  )
}
