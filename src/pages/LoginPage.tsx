import { Navigate, useNavigate } from 'react-router-dom'
import wellnessHero from '../assets/eyeguard-wellness-hero.png'
import { useAuth } from '../context/AuthContext'

export function LoginPage() {
  const navigate = useNavigate()
  const { isReady, currentUser, loginAsGuest } = useAuth()

  if (isReady && currentUser) {
    return <Navigate to="/" replace />
  }

  const handleGuestLogin = () => {
    loginAsGuest()
    navigate('/')
  }

  return (
    <main className="auth-shell auth-shell-wellness">
      <section className="auth-layout">
        <article className="auth-intro auth-intro-wellness">
          <span className="eyebrow">EyeGuard</span>
          <h1>Бережные рабочие сессии для внимания и отдыха глаз</h1>
          <p>
            Начните без регистрации. История и настройки останутся только в этом браузере.
          </p>
          <div className="auth-wellness-points" aria-label="Особенности EyeGuard">
            <span>Обработка камеры на устройстве</span>
            <span>Без аккаунта, email и пароля</span>
          </div>
          <img src={wellnessHero} alt="Иллюстрация рабочего места EyeGuard" />
        </article>

        <article className="auth-card auth-card-wellness">
          <span className="auth-card-brand">EyeGuard</span>
          <div className="auth-card-header">
            <h2>Начать работу</h2>
            <p>Аккаунт, email и пароль не нужны.</p>
          </div>

          <div className="auth-form">
            <p>
              Серверный профиль не создаётся. Данные рабочих сессий сохраняются локально
              на этом устройстве.
            </p>
            <div className="auth-actions">
              <button className="primary-button" type="button" onClick={handleGuestLogin}>
                Продолжить без регистрации
              </button>
            </div>
          </div>
        </article>
      </section>
    </main>
  )
}
