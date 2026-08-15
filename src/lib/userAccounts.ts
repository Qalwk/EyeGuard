import type { AccountsData, AuthSession, UserAccount, UserAccountFormValues } from '../types/user'

const ACCOUNTS_STORAGE_KEY = 'eyeguard-accounts'
const SESSION_STORAGE_KEY = 'eyeguard-session'
const ACCOUNTS_JSON_URL = '/data/accounts.json'

function formatCreatedAt(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function loadAccountsFromStorage(): AccountsData | null {
  const rawValue = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as AccountsData
  } catch {
    return null
  }
}

export function saveAccountsToStorage(data: AccountsData) {
  window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(data))
}

export async function loadAccountsData(): Promise<AccountsData> {
  const storedData = loadAccountsFromStorage()

  if (storedData) {
    return storedData
  }

  const response = await fetch(ACCOUNTS_JSON_URL)

  if (!response.ok) {
    throw new Error('Не удалось загрузить файл учётных записей.')
  }

  const data = (await response.json()) as AccountsData
  saveAccountsToStorage(data)
  return data
}

export function loadAuthSession(): AuthSession | null {
  const rawValue = window.sessionStorage.getItem(SESSION_STORAGE_KEY)

  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as AuthSession
  } catch {
    return null
  }
}

export function saveAuthSession(session: AuthSession) {
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearAuthSession() {
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
}

export function createGuestUser(): UserAccount {
  return {
    id: 0,
    email: '',
    login: 'guest',
    name: 'Гость',
    password: '',
    roleId: 2,
    createdAt: '',
  }
}

export function isGuestSession(session: AuthSession): session is { guest: true } {
  return 'guest' in session && session.guest === true
}

export function findUserByLogin(users: UserAccount[], login: string) {
  const normalizedLogin = login.trim().toLowerCase()

  return users.find((user) => user.login.toLowerCase() === normalizedLogin) ?? null
}

export function findUserById(users: UserAccount[], userId: number) {
  return users.find((user) => user.id === userId) ?? null
}

export function authenticateUser(
  users: UserAccount[],
  login: string,
  password: string,
): UserAccount | null {
  const user = findUserByLogin(users, login)

  if (!user) {
    return null
  }

  if (user.password !== password.trim()) {
    return null
  }

  return user
}

export function getNextUserId(users: UserAccount[]) {
  if (users.length === 0) {
    return 1
  }

  return Math.max(...users.map((user) => user.id)) + 1
}

export function isLoginTaken(users: UserAccount[], login: string, excludeUserId?: number) {
  const normalizedLogin = login.trim().toLowerCase()

  return users.some(
    (user) => user.login.toLowerCase() === normalizedLogin && user.id !== excludeUserId,
  )
}

export function isEmailTaken(users: UserAccount[], email: string, excludeUserId?: number) {
  const normalizedEmail = email.trim().toLowerCase()

  return users.some(
    (user) => user.email.toLowerCase() === normalizedEmail && user.id !== excludeUserId,
  )
}

export function createUserAccount(
  data: AccountsData,
  form: UserAccountFormValues,
): { data: AccountsData; user: UserAccount } | { error: string } {
  if (isLoginTaken(data.users, form.login)) {
    return { error: 'Пользователь с таким логином уже существует.' }
  }

  if (isEmailTaken(data.users, form.email)) {
    return { error: 'Пользователь с таким email уже существует.' }
  }

  const user: UserAccount = {
    id: getNextUserId(data.users),
    email: form.email.trim(),
    login: form.login.trim(),
    name: form.name.trim(),
    password: form.password,
    roleId: form.roleId,
    createdAt: formatCreatedAt(new Date()),
  }

  const nextData: AccountsData = {
    ...data,
    users: [...data.users, user],
  }

  saveAccountsToStorage(nextData)
  return { data: nextData, user }
}

export function updateUserAccount(
  data: AccountsData,
  userId: number,
  form: UserAccountFormValues,
): { data: AccountsData; user: UserAccount } | { error: string } {
  const existingUser = findUserById(data.users, userId)

  if (!existingUser) {
    return { error: 'Пользователь не найден.' }
  }

  if (isLoginTaken(data.users, form.login, userId)) {
    return { error: 'Пользователь с таким логином уже существует.' }
  }

  if (isEmailTaken(data.users, form.email, userId)) {
    return { error: 'Пользователь с таким email уже существует.' }
  }

  const updatedUser: UserAccount = {
    ...existingUser,
    email: form.email.trim(),
    login: form.login.trim(),
    name: form.name.trim(),
    password: form.password,
    roleId: form.roleId,
  }

  const nextData: AccountsData = {
    ...data,
    users: data.users.map((user) => (user.id === userId ? updatedUser : user)),
  }

  saveAccountsToStorage(nextData)
  return { data: nextData, user: updatedUser }
}

export function updateUserRole(
  data: AccountsData,
  userId: number,
  roleId: number,
): AccountsData {
  const nextData: AccountsData = {
    ...data,
    users: data.users.map((user) => (user.id === userId ? { ...user, roleId } : user)),
  }

  saveAccountsToStorage(nextData)
  return nextData
}

export function deleteUserAccount(
  data: AccountsData,
  userId: number,
): { data: AccountsData } | { error: string } {
  const admins = data.users.filter((user) => user.roleId === 1)
  const targetUser = findUserById(data.users, userId)

  if (!targetUser) {
    return { error: 'Пользователь не найден.' }
  }

  if (targetUser.roleId === 1 && admins.length <= 1) {
    return { error: 'Нельзя удалить последнего администратора.' }
  }

  const nextData: AccountsData = {
    ...data,
    users: data.users.filter((user) => user.id !== userId),
  }

  saveAccountsToStorage(nextData)
  return { data: nextData }
}

export function isAdminUser(user: UserAccount | null) {
  return user?.roleId === 1
}

export function resetAccountsFromJsonSeed() {
  window.localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
}
