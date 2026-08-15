export type AuthFormValues = {
  fullName: string
  email: string
  login: string
  password: string
  confirmPassword: string
}

export type AuthFormErrors = Partial<Record<keyof AuthFormValues, string>>

export type AuthMode = 'register' | 'login'

export const THRESHOLD_MIN = 10
export const THRESHOLD_MAX = 100

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LOGIN_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/
const FULL_NAME_PATTERN = /^[А-Яа-яA-Za-zЁё\- ]+$/

function normalizeText(value: string) {
  return value.trim()
}

export function validateAuthForm(mode: AuthMode, form: AuthFormValues): AuthFormErrors {
  const errors: AuthFormErrors = {}
  const login = normalizeText(form.login)
  const password = normalizeText(form.password)

  if (!login) {
    errors.login = 'Укажите логин.'
  } else if (!LOGIN_PATTERN.test(login)) {
    errors.login = 'Логин: от 3 до 32 символов, только латиница, цифры, «_», «.» и «-».'
  }

  if (!password) {
    errors.password = 'Укажите пароль.'
  } else if (password.length < 6) {
    errors.password = 'Пароль должен содержать не менее 6 символов.'
  }

  if (mode === 'register') {
    const fullName = normalizeText(form.fullName)
    const email = normalizeText(form.email)
    const confirmPassword = normalizeText(form.confirmPassword)
    const nameParts = fullName.split(/\s+/).filter(Boolean)

    if (!fullName) {
      errors.fullName = 'Укажите имя и фамилию.'
    } else if (nameParts.length !== 2) {
      errors.fullName = 'Допускаются только имя и фамилия — ровно два слова через пробел.'
    } else if (fullName.length < 5) {
      errors.fullName = 'Имя и фамилия должны содержать не менее 5 символов.'
    } else if (!FULL_NAME_PATTERN.test(fullName)) {
      errors.fullName = 'Имя и фамилия могут содержать только буквы, пробел и дефис.'
    }

    if (!email) {
      errors.email = 'Укажите адрес электронной почты.'
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Введите корректный адрес электронной почты.'
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Повторите пароль.'
    } else if (confirmPassword !== password) {
      errors.confirmPassword = 'Пароли не совпадают.'
    }
  }

  return errors
}

export function hasAuthErrors(errors: AuthFormErrors) {
  return Object.keys(errors).length > 0
}

export type UserAccountFormValues = {
  email: string
  login: string
  name: string
  password: string
  roleId: number
}

export type UserAccountFormErrors = Partial<Record<keyof UserAccountFormValues, string>>

export function validateUserAccountForm(
  form: UserAccountFormValues,
  options: { requirePassword: boolean },
): UserAccountFormErrors {
  const errors: UserAccountFormErrors = {}
  const email = normalizeText(form.email)
  const login = normalizeText(form.login)
  const name = normalizeText(form.name)
  const password = normalizeText(form.password)
  const nameParts = name.split(/\s+/).filter(Boolean)

  if (!email) {
    errors.email = 'Укажите адрес электронной почты.'
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'Введите корректный адрес электронной почты.'
  }

  if (!login) {
    errors.login = 'Укажите логин.'
  } else if (!LOGIN_PATTERN.test(login)) {
    errors.login = 'Логин: от 3 до 32 символов, только латиница, цифры, «_», «.» и «-».'
  }

  if (!name) {
    errors.name = 'Укажите имя пользователя.'
  } else if (nameParts.length !== 2) {
    errors.name = 'Допускаются только имя и фамилия — ровно два слова через пробел.'
  } else if (name.length < 5) {
    errors.name = 'Имя и фамилия должны содержать не менее 5 символов.'
  } else if (!FULL_NAME_PATTERN.test(name)) {
    errors.name = 'Имя и фамилия могут содержать только буквы, пробел и дефис.'
  }

  if (options.requirePassword && !password) {
    errors.password = 'Укажите пароль.'
  } else if (password && password.length < 6) {
    errors.password = 'Пароль должен содержать не менее 6 символов.'
  }

  if (!form.roleId) {
    errors.roleId = 'Выберите роль.'
  }

  return errors
}

export function hasUserAccountErrors(errors: UserAccountFormErrors) {
  return Object.keys(errors).length > 0
}

export function validateThresholdInput(rawValue: string) {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return {
      value: null,
      error: 'Укажите пороговое значение утомления.',
    }
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      value: null,
      error: 'Порог должен быть целым числом без пробелов и символов.',
    }
  }

  const parsedValue = Number(trimmed)

  if (parsedValue < THRESHOLD_MIN) {
    return {
      value: null,
      error: `Минимально допустимое значение — ${THRESHOLD_MIN}.`,
    }
  }

  if (parsedValue > THRESHOLD_MAX) {
    return {
      value: null,
      error: `Максимально допустимое значение — ${THRESHOLD_MAX}.`,
    }
  }

  return {
    value: parsedValue,
    error: '',
  }
}

export function clampThreshold(value: number) {
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value))
}
