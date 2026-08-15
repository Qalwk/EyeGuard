import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { AdminPage } from './pages/AdminPage'
import { DatabasePage } from './pages/DatabasePage'
import { LoginPage } from './pages/LoginPage'
import { MonitorPage } from './pages/MonitorPage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/bd" element={<DatabasePage />} />
        <Route path="/db" element={<Navigate to="/bd" replace />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<MonitorPage />} />
        </Route>
        <Route element={<ProtectedRoute requireAdmin />}>
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
