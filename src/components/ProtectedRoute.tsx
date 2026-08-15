import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type ProtectedRouteProps = {
  requireAdmin?: boolean
}

export function ProtectedRoute({ requireAdmin = false }: ProtectedRouteProps) {
  const { isReady, currentUser, isAdmin } = useAuth()

  if (!isReady) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <p>Загрузка учётных записей...</p>
        </section>
      </main>
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
