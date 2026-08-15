import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AccountsData, UserAccount, UserAccountFormValues } from '../types/user'
import {
  authenticateUser,
  clearAuthSession,
  createUserAccount,
  deleteUserAccount,
  findUserById,
  isAdminUser,
  loadAccountsData,
  loadAuthSession,
  saveAuthSession,
  updateUserAccount,
  updateUserRole,
} from '../lib/userAccounts'

type AuthContextValue = {
  isReady: boolean
  accountsData: AccountsData | null
  currentUser: UserAccount | null
  isAdmin: boolean
  login: (loginValue: string, password: string) => string | null
  register: (form: UserAccountFormValues) => string | null
  logout: () => void
  addUser: (form: UserAccountFormValues) => string | null
  editUser: (userId: number, form: UserAccountFormValues) => string | null
  changeUserRole: (userId: number, roleId: number) => void
  removeUser: (userId: number) => string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [accountsData, setAccountsData] = useState<AccountsData | null>(null)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null)

  useEffect(() => {
    let isMounted = true

    async function bootstrap() {
      try {
        const data = await loadAccountsData()

        if (!isMounted) {
          return
        }

        setAccountsData(data)

        const session = loadAuthSession()

        if (session) {
          const user = findUserById(data.users, session.userId)
          setCurrentUser(user)
        }
      } catch {
        if (isMounted) {
          setAccountsData({ roles: [], users: [] })
        }
      } finally {
        if (isMounted) {
          setIsReady(true)
        }
      }
    }

    void bootstrap()

    return () => {
      isMounted = false
    }
  }, [])

  const login = useCallback(
    (loginValue: string, password: string) => {
      if (!accountsData) {
        return 'Список учётных записей ещё не загружен.'
      }

      const user = authenticateUser(accountsData.users, loginValue, password)

      if (!user) {
        return 'Неверный логин или пароль. Вход возможен только для зарегистрированных аккаунтов.'
      }

      saveAuthSession({ userId: user.id })
      setCurrentUser(user)
      return null
    },
    [accountsData],
  )

  const logout = useCallback(() => {
    clearAuthSession()
    setCurrentUser(null)
  }, [])

  const register = useCallback(
    (form: UserAccountFormValues) => {
      if (!accountsData) {
        return 'Список учётных записей недоступен.'
      }

      const defaultUserRoleId =
        accountsData.roles.find((role) => role.name === 'user')?.id ?? 2

      const result = createUserAccount(accountsData, {
        ...form,
        roleId: defaultUserRoleId,
      })

      if ('error' in result) {
        return result.error
      }

      setAccountsData(result.data)
      saveAuthSession({ userId: result.user.id })
      setCurrentUser(result.user)
      return null
    },
    [accountsData],
  )

  const addUser = useCallback(
    (form: UserAccountFormValues) => {
      if (!accountsData) {
        return 'Список учётных записей недоступен.'
      }

      const result = createUserAccount(accountsData, form)

      if ('error' in result) {
        return result.error
      }

      setAccountsData(result.data)
      return null
    },
    [accountsData],
  )

  const editUser = useCallback(
    (userId: number, form: UserAccountFormValues) => {
      if (!accountsData) {
        return 'Список учётных записей недоступен.'
      }

      const result = updateUserAccount(accountsData, userId, form)

      if ('error' in result) {
        return result.error
      }

      setAccountsData(result.data)

      if (currentUser?.id === userId) {
        setCurrentUser(result.user)
      }

      return null
    },
    [accountsData, currentUser],
  )

  const changeUserRole = useCallback(
    (userId: number, roleId: number) => {
      if (!accountsData) {
        return
      }

      const nextData = updateUserRole(accountsData, userId, roleId)
      setAccountsData(nextData)

      if (currentUser?.id === userId) {
        const updatedUser = findUserById(nextData.users, userId)
        setCurrentUser(updatedUser)
      }
    },
    [accountsData, currentUser],
  )

  const removeUser = useCallback(
    (userId: number) => {
      if (!accountsData) {
        return 'Список учётных записей недоступен.'
      }

      const result = deleteUserAccount(accountsData, userId)

      if ('error' in result) {
        return result.error
      }

      setAccountsData(result.data)

      if (currentUser?.id === userId) {
        clearAuthSession()
        setCurrentUser(null)
      }

      return null
    },
    [accountsData, currentUser],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      accountsData,
      currentUser,
      isAdmin: isAdminUser(currentUser),
      login,
      register,
      logout,
      addUser,
      editUser,
      changeUserRole,
      removeUser,
    }),
    [
      isReady,
      accountsData,
      currentUser,
      login,
      register,
      logout,
      addUser,
      editUser,
      changeUserRole,
      removeUser,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider.')
  }

  return context
}
