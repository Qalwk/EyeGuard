import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

const SESSION_STORAGE_KEY = 'eyeguard-session'

type GuestUser = {
  id: 0
  login: 'guest'
  name: 'Гость'
}

const GUEST_USER: GuestUser = {
  id: 0,
  login: 'guest',
  name: 'Гость',
}

type AuthContextValue = {
  isReady: boolean
  currentUser: GuestUser | null
  loginAsGuest: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function hasGuestSession() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const session = JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? 'null')
    return session?.guest === true
  } catch {
    return false
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<GuestUser | null>(() =>
    hasGuestSession() ? GUEST_USER : null,
  )

  const loginAsGuest = useCallback(() => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ guest: true }))
    setCurrentUser(GUEST_USER)
  }, [])

  const logout = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    setCurrentUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady: true,
      currentUser,
      loginAsGuest,
      logout,
    }),
    [currentUser, loginAsGuest, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// This module intentionally exports the provider and its paired hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider.')
  }

  return context
}
