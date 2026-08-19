import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type AppLayoutProps = {
  title: string
  description: string
  actions?: React.ReactNode
  children: React.ReactNode
  variant?: 'default' | 'wellness'
  heroVisual?: React.ReactNode
}

export function AppLayout({
  title,
  description,
  actions,
  children,
  variant = 'default',
  heroVisual,
}: AppLayoutProps) {
  const navigate = useNavigate()
  const { currentUser, isAdmin, logout } = useAuth()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navigation = (
    <div className="page-switcher" role="navigation" aria-label="Разделы приложения">
      <NavLink
        to="/"
        className={({ isActive }) => (isActive ? 'page-tab active' : 'page-tab')}
        end
      >
        Мониторинг
      </NavLink>
      <NavLink
        to="/roadmap"
        className={({ isActive }) => (isActive ? 'page-tab active' : 'page-tab')}
      >
        План развития
      </NavLink>
      {isAdmin ? (
        <NavLink
          to="/admin"
          className={({ isActive }) => (isActive ? 'page-tab active' : 'page-tab')}
        >
          Админ панель
        </NavLink>
      ) : null}
      <button type="button" className="page-tab page-tab-logout" onClick={handleLogout}>
        Выйти ({currentUser?.login})
      </button>
    </div>
  )

  return (
    <main className={`app-shell${variant === 'wellness' ? ' app-shell-wellness' : ''}`}>
      {variant === 'wellness' ? (
        <header className="wellness-topbar">
          <span className="wellness-brand">EyeGuard</span>
          {navigation}
        </header>
      ) : (
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">EyeGuard</span>
            <div className="hero-topline">
              <h1>{title}</h1>
              {navigation}
            </div>
            <p>{description}</p>
          </div>
          {heroVisual ? <div className="hero-visual">{heroVisual}</div> : null}
          {actions}
        </section>
      )}
      {children}
    </main>
  )
}
