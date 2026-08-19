import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { AdminPage } from './pages/AdminPage'
import { LoginPage } from './pages/LoginPage'
import { HistoryPage } from './pages/HistoryPage'
import { MonitorPage } from './pages/MonitorPage'
import { RoadmapPage } from './pages/RoadmapPage'
import { SessionDetailPage } from './pages/SessionDetailPage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:sessionId" element={<SessionDetailPage />} />
          <Route path="/roadmap" element={<RoadmapPage />} />
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
