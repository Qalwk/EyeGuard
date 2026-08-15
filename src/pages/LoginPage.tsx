import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  hasAuthErrors,
  validateAuthForm,
  type AuthFormErrors,
  type AuthMode,
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
  const { isReady, currentUser, login, loginAsGuest, register } = useAuth()
  const [authMode, setAuthMode] = useState<AuthMode>('register')
  const [form, setForm] = useState<AuthFormState>(initialAuthForm)
  const [errors, setErrors] = useState<AuthFormErrors>({})
  const [formError, setFormError] = useState('')

  if (isReady && currentUser) {
    return <Navigate to="/" replace />
  }

  const handleInputChange = (field: keyof AuthFormState, value: string) => {
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

  const handleAuthModeChange = (mode: AuthMode) => {
    setAuthMode(mode)
    setErrors({})
    setFormError('')
  }

  const handleGuestLogin = () => {
    loginAsGuest()
    navigate('/')
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateAuthForm(authMode, form)

    if (hasAuthErrors(nextErrors)) {
      setErrors(nextErrors)
      setFormError('Исправьте ошибки в форме перед продолжением.')
      return
    }

    if (authMode === 'register') {
      const registerError = register({
        email: form.email,
        login: form.login,
        name: form.fullName,
        password: form.password,
        roleId: 2,
      })

      if (registerError) {
        setFormError(registerError)
        return
      }
    } else {
      const loginError = login(form.login, form.password)

      if (loginError) {
        setFormError(loginError)
        return
      }
    }

    setErrors({})
    setFormError('')
    navigate('/')
  }

  const renderFieldError = (field: keyof AuthFormState) => {
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
    <main className="auth-shell">
      <section className="auth-layout">
        <article className="auth-intro">
          <span className="eyebrow">EyeGuard</span>
          <h1>Регистрация и вход в систему мониторинга утомления</h1>
          <p>
            Для демонстрации:
            `apetrova` / `admin123` (администратор) или `ismirnov` / `user123` (пользователь).
          </p>
        </article>

        <article className="auth-card">
          <div className="auth-mode-switcher" role="tablist" aria-label="Формы доступа">
            <button
              type="button"
              className={authMode === 'register' ? 'auth-mode-tab active' : 'auth-mode-tab'}
              onClick={() => handleAuthModeChange('register')}
            >
              Регистрация
            </button>
            <button
              type="button"
              className={authMode === 'login' ? 'auth-mode-tab active' : 'auth-mode-tab'}
              onClick={() => handleAuthModeChange('login')}
            >
              Вход
            </button>
          </div>

          <div className="auth-card-header">
            <h2>
              {authMode === 'register' ? 'Создание учётной записи' : 'Вход в систему'}
            </h2>
            <p>
              {authMode === 'register'
                ? 'Заполните форму — аккаунт будет добавлен в хранилище приложения.'
                : 'Введите логин и пароль существующего аккаунта.'}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {authMode === 'register' ? (
              <>
                <label className={`auth-field${errors.fullName ? ' auth-field-invalid' : ''}`}>
                  <span>Имя Фамилия</span>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(event) => handleInputChange('fullName', event.target.value)}
                    placeholder="Иванов Иван"
                    aria-invalid={Boolean(errors.fullName)}
                  />
                  {renderFieldError('fullName')}
                </label>
                <label className={`auth-field${errors.email ? ' auth-field-invalid' : ''}`}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => handleInputChange('email', event.target.value)}
                    placeholder="user@mail.ru"
                    aria-invalid={Boolean(errors.email)}
                  />
                  {renderFieldError('email')}
                </label>
              </>
            ) : null}

            <label className={`auth-field${errors.login ? ' auth-field-invalid' : ''}`}>
              <span>Логин</span>
              <input
                type="text"
                value={form.login}
                onChange={(event) => handleInputChange('login', event.target.value)}
                placeholder="username"
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
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                aria-invalid={Boolean(errors.password)}
              />
              {renderFieldError('password')}
            </label>

            {authMode === 'register' ? (
              <label
                className={`auth-field${errors.confirmPassword ? ' auth-field-invalid' : ''}`}
              >
                <span>Повтор пароля</span>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(event) => handleInputChange('confirmPassword', event.target.value)}
                  placeholder="Повторите пароль"
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.confirmPassword)}
                />
                {renderFieldError('confirmPassword')}
              </label>
            ) : null}

            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}

            <div className="auth-actions">
              <button className="primary-button" type="submit">
                {authMode === 'register' ? 'Зарегистрироваться и войти' : 'Войти'}
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
