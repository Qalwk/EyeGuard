import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute() {
  const { isReady, currentUser } = useAuth()

  if (!isReady) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <p>Загрузка приложения...</p>
        </section>
      </main>
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
