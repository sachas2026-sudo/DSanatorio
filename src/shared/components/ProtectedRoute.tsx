import { Navigate, useLocation } from 'react-router-dom'
import { useAuthSession } from '../../context/AuthContext'

type Props = {
  path: string
  children: React.ReactNode
}

export function ProtectedRoute({ path, children }: Props) {
  const { session, canAccessPath } = useAuthSession()
  const location = useLocation()

  if (!session) {
    return null
  }

  if (!canAccessPath(path)) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
