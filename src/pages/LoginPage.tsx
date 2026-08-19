import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import wellnessHero from '../assets/eyeguard-wellness-hero.png'
import { useAuth } from '../context/AuthContext'
import {
  hasAuthErrors,
  validateAuthForm,
  type AuthFormErrors,
} from '../lib/formValidation'

type AuthFormState = {
  fullName: string
  email: string
  login: string
  password: string
  confirmPassword: string
}

const initialAuthForm: AuthFormState = {
  fullName: '',
  email: '',
  login: '',
  password: '',
  confirmPassword: '',
}

export function LoginPage() {
  const navigate = useNavigate()
  const { isReady, currentUser, login, loginAsGuest } = useAuth()
  const [form, setForm] = useState<AuthFormState>(initialAuthForm)
  const [errors, setErrors] = useState<AuthFormErrors>({})
  const [formError, setFormError] = useState('')

  if (isReady && currentUser) {
    return <Navigate to="/" replace />
  }

  const handleInputChange = (field: 'login' | 'password', value: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
    setFormError('')

    if (errors[field]) {
      setErrors((currentErrors) => {
        const nextErrors = { ...currentErrors }
        delete nextErrors[field]
        return nextErrors
      })
    }
  }

  const handleGuestLogin = () => {
    loginAsGuest()
    navigate('/')
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateAuthForm('login', form)

    if (hasAuthErrors(nextErrors)) {
      setErrors(nextErrors)
      setFormError('Исправьте ошибки в форме перед продолжением.')
      return
    }

    const loginError = login(form.login, form.password)

    if (loginError) {
      setFormError(loginError)
      return
    }

    setErrors({})
    setFormError('')
    navigate('/')
  }

  const renderFieldError = (field: 'login' | 'password') => {
    const message = errors[field]

    if (!message) {
      return null
    }

    return (
      <span className="field-error" role="alert">
        {message}
      </span>
    )
  }

  return (
    <main className="auth-shell auth-shell-wellness">
      <section className="auth-layout">
        <article className="auth-intro auth-intro-wellness">
          <span className="eyebrow">EyeGuard</span>
          <h1>Бережные рабочие сессии для внимания и отдыха глаз</h1>
          <p>
            Войдите в существующий аккаунт или попробуйте приложение без регистрации.
          </p>
          <div className="auth-wellness-points" aria-label="Преимущества EyeGuard">
            <span>Обработка камеры на устройстве</span>
            <span>Гостевой режим без регистрации</span>
          </div>
          <img src={wellnessHero} alt="Иллюстрация рабочего места EyeGuard" />
        </article>

        <article className="auth-card auth-card-wellness">
          <span className="auth-card-brand">EyeGuard</span>
          <div className="auth-card-header">
            <h2>Вход в EyeGuard</h2>
            <p>Введите логин и пароль или продолжите в гостевом режиме.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className={`auth-field${errors.login ? ' auth-field-invalid' : ''}`}>
              <span>Логин</span>
              <input
                type="text"
                value={form.login}
                onChange={(event) => handleInputChange('login', event.target.value)}
                placeholder="Введите логин"
                autoComplete="username"
                aria-invalid={Boolean(errors.login)}
              />
              {renderFieldError('login')}
            </label>

            <label className={`auth-field${errors.password ? ' auth-field-invalid' : ''}`}>
              <span>Пароль</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => handleInputChange('password', event.target.value)}
                placeholder="Введите пароль"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
              />
              {renderFieldError('password')}
            </label>

            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="auth-actions">
              <button className="primary-button" type="submit">
                Войти
              </button>
              <button className="secondary-button" type="button" onClick={handleGuestLogin}>
                Войти без регистрации
              </button>
            </div>
          </form>
        </article>
      </section>
    </main>
  )
}
