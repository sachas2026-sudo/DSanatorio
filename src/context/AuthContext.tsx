import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  authenticate,
  canAccessPath,
  clearStoredSession,
  ensureAuthAccountsLoaded,
  isUsingDefaultAccounts,
  migrateAllPlainPasswordAccounts,
  revalidateStoredSession,
  storeSession,
  type AppRole,
  type AuthSession,
  type LoginAttemptResult,
} from '../lib/auth'
import { isClientMode, clearAppModeCache } from '../lib/appMode'
import { useConfirm } from './ConfirmContext'

type ClientSessionInfo = {
  username: string
  role: string
  displayName: string
  mustChangePassword: boolean
}

function isValidRole(role: string): role is AppRole {
  return role === 'admin' || role === 'secretaria' || role === 'afiliado'
}

function sessionFromClientInfo(info: ClientSessionInfo): AuthSession | null {
  if (!isValidRole(info.role)) return null
  return {
    username: info.username,
    role: info.role,
    displayName: info.displayName || info.username,
    mustChangePassword: info.mustChangePassword,
  }
}

async function writeLoginDiagnostic(kind: 'invalid_credentials' | 'network_error') {
  if (!isTauri()) return
  try {
    await invoke('write_login_diagnostic', { kind })
  } catch (error) {
    console.error('No se pudo escribir Erroes.log:', error)
  }
}

type AuthCtx = {
  session: AuthSession | null
  authReady: boolean
  login: (username: string, password: string) => Promise<LoginAttemptResult>
  logout: () => void
  canAccessPath: (pathname: string) => boolean
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { confirm } = useConfirm()
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (await isClientMode()) {
          // En modo cliente la sesión real vive en Rust (el token nunca llega
          // al frontend). Si la app se reinició, hay que volver a ingresar.
          const info = await invoke<ClientSessionInfo | null>('client_session_info')
          if (cancelled) return
          const restored = info ? sessionFromClientInfo(info) : null
          if (restored) {
            storeSession(restored)
            setSession(restored)
          } else {
            clearStoredSession()
            setSession(null)
          }
          return
        }
        await ensureAuthAccountsLoaded()
        if (cancelled) return
        // Migrar todas las cuentas con contraseñas en texto plano
        void migrateAllPlainPasswordAccounts()
        setSession(revalidateStoredSession())
      } catch (err) {
        console.error('Error al preparar autenticación:', err)
        if (cancelled) return
        // Intentar migración incluso si hay error al cargar cuentas
        void migrateAllPlainPasswordAccounts()
        setSession(revalidateStoredSession())
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session || !isTauri()) return

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const startHeartbeat = async () => {
      try {
        if (!(await isClientMode()) || cancelled) return
        timer = setInterval(() => {
          void invoke('client_heartbeat').catch((error: unknown) => {
            console.warn('No se pudo actualizar la conexión con el servidor:', error)
          })
        }, 30_000)
      } catch (error) {
        console.error('No se pudo iniciar el heartbeat del cliente:', error)
      }
    }

    void startHeartbeat()
    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [session])

  const login = useCallback(
    async (username: string, password: string): Promise<LoginAttemptResult> => {
      if (await isClientMode()) {
        try {
          const info = await invoke<ClientSessionInfo>('client_login', {
            username,
            password,
          })
          const clientSession = sessionFromClientInfo(info)
          if (!clientSession) {
            return { ok: false, reason: 'invalid_credentials' }
          }
          storeSession(clientSession)
          setSession(clientSession)
          return { ok: true, session: clientSession }
        } catch (err) {
          const message =
            typeof err === 'string' ? err : err instanceof Error ? err.message : ''
          // Si el backend detectó que el servidor local está en esta máquina, conmutar transparente
          if (message.includes('servidor_local_detectado')) {
            clearAppModeCache()
            await ensureAuthAccountsLoaded()
            const result = await authenticate(username, password)
            if (result.ok) {
              storeSession(result.session)
              setSession(result.session)
            } else if (result.reason === 'invalid_credentials') {
              await writeLoginDiagnostic('invalid_credentials')
            }
            return result
          }
          // Error de credenciales: se muestra el mensaje estándar del login.
          if (/incorrect|credencial|usuario o contrase/i.test(message)) {
            await writeLoginDiagnostic('invalid_credentials')
            return { ok: false, reason: 'invalid_credentials' }
          }
          // Sin conexión / configuración: que LoginScreen muestre el error genérico.
          await writeLoginDiagnostic('network_error')
          throw err
        }
      }
      await ensureAuthAccountsLoaded()
      const wasDefaults = isUsingDefaultAccounts()
      const result = await authenticate(username, password)
      if (!result.ok) {
        if (result.reason === 'invalid_credentials') {
          await writeLoginDiagnostic('invalid_credentials')
        }
        return result
      }
      storeSession(result.session)
      setSession(result.session)
      if (wasDefaults) {
        void confirm({
          title: 'Seguridad',
          message:
            'Está usando contraseñas por defecto (Admi/Admi).\n\nCámbielas en Configuración → Usuarios y contraseñas.',
          confirmLabel: 'Entendido',
          cancelLabel: 'Cerrar',
        })
      }
      return result
    },
    [confirm],
  )

  const logout = useCallback(() => {
    clearStoredSession()
    setSession(null)
    void isClientMode().then((client) => {
      if (client) void invoke('client_logout')
    })
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
      authReady,
      login,
      logout,
      canAccessPath: canAccess,
    }),
    [session, authReady, login, logout, canAccess],
  )

  if (!authReady) {
    return <div className="boot-placeholder" aria-hidden />
  }

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
