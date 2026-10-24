import type { ReactNode } from 'react'
import { AuthProvider, useAuthSession } from '../../context/AuthContext'
import { LoginScreen } from './LoginScreen'

function AuthGateInner({ children }: { children: ReactNode }) {
  const { session, login } = useAuthSession()

  if (!session) {
    return (
      <LoginScreen
        onSuccess={(username, password) => login(username, password)}
      />
    )
  }

  return <>{children}</>
}

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGateInner>{children}</AuthGateInner>
    </AuthProvider>
  )
}
