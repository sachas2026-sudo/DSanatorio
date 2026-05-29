import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  authenticate,
  canAccessPath,
  clearStoredSession,
  isUsingDefaultAccounts,
  readStoredSession,
  storeSession,
  type AppRole,
  type AuthSession,
} from '../lib/auth'
import { useConfirm } from './ConfirmContext'

type AuthCtx = {
  session: AuthSession | null
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  canAccessPath: (pathname: string) => boolean
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { confirm } = useConfirm()
  const [session, setSession] = useState<AuthSession | null>(() =>
    readStoredSession(),
  )

  const login = useCallback(
    async (username: string, password: string) => {
      const wasDefaults = isUsingDefaultAccounts()
      const next = await authenticate(username, password)
      if (!next) return false
      storeSession(next)
      setSession(next)
      if (wasDefaults) {
        void confirm({
          title: 'Seguridad',
          message:
            'Está usando contraseñas por defecto (Admi/Admi).\n\nCámbielas en Configuración → Usuarios y contraseñas.',
          confirmLabel: 'Entendido',
          cancelLabel: 'Cerrar',
        })
      }
      return true
    },
    [confirm],
  )

  const logout = useCallback(() => {
    clearStoredSession()
    setSession(null)
  }, [])

  const canAccess = useCallback(
    (pathname: string) => {
      if (!session) return false
      return canAccessPath(session.role, pathname)
    },
    [session],
  )

  const value = useMemo(
    () => ({
      session,
      login,
      logout,
      canAccessPath: canAccess,
    }),
    [session, login, logout, canAccess],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

export function useAuthSession() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthSession debe usarse dentro de AuthProvider')
  }
  return ctx
}

export function useAuth() {
  const { session, ...rest } = useAuthSession()
  if (!session) {
    throw new Error('useAuth requiere sesión iniciada')
  }
  return { session, role: session.role as AppRole, ...rest }
}
