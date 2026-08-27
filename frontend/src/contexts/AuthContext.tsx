import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as authApi from '@/api/auth'
import { clearTokens, getTokens, setTokens, subscribeToTokenChanges } from '@/lib/token-store'
import { decodeJwtPayload, getMsUntilExpiry } from '@/lib/jwt'
import type { AuthenticatedUser } from '@/types/api'
import type { UserProfile } from '@/api/auth'

interface AuthContextValue {
  user: AuthenticatedUser | null
  // The richer /auth/me-sourced profile (adds email, which the JWT payload
  // doesn't carry). null until it loads, even when isAuthenticated — most
  // UI should keep using `user` for role/departmentId; `profile` is only
  // for places that specifically need to display the email (e.g. Settings).
  profile: UserProfile | null
  isAuthenticated: boolean
  isInitializing: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Refresh proactively at the 13-minute mark of a 15-minute access token
// (PRD Section 4.3) — a 2-minute buffer so an active user is never
// interrupted mid-task by an expired-token error.
const REFRESH_BUFFER_MS = 2 * 60 * 1000

function deriveUser(accessToken: string | null): AuthenticatedUser | null {
  if (!accessToken) return null
  const payload = decodeJwtPayload(accessToken)
  if (!payload) return null
  return { userId: payload.sub, role: payload.role, departmentId: payload.departmentId }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(() => deriveUser(getTokens().accessToken))
  // The refresh token persists across reloads (src/lib/token-store.ts),
  // but the access token never does — so on every mount, if a refresh
  // token exists with no access token yet, silently mint a fresh one
  // before rendering protected routes. isInitializing is true only for
  // that brief window, so ProtectedRoute doesn't flash a redirect to
  // /login while this is still in flight.
  const [isInitializing, setIsInitializing] = useState(
    () => getTokens().refreshToken !== null && getTokens().accessToken === null,
  )
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const msUntilRefresh = Math.max(getMsUntilExpiry(accessToken) - REFRESH_BUFFER_MS, 0)
    refreshTimerRef.current = setTimeout(async () => {
      const { refreshToken } = getTokens()
      if (!refreshToken) return
      try {
        const result = await authApi.refresh(refreshToken)
        setTokens({ accessToken: result.accessToken, refreshToken })
      } catch {
        clearTokens()
      }
    }, msUntilRefresh)
  }, [])

  useEffect(() => {
    return subscribeToTokenChanges(() => {
      const { accessToken } = getTokens()
      setUser(deriveUser(accessToken))
      if (accessToken) {
        scheduleRefresh(accessToken)
      } else if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    })
  }, [scheduleRefresh])

  useEffect(() => {
    const { accessToken, refreshToken } = getTokens()
    if (accessToken || !refreshToken) {
      setIsInitializing(false)
      return
    }

    authApi
      .refresh(refreshToken)
      .then((result) => setTokens({ accessToken: result.accessToken, refreshToken }))
      .catch(() => clearTokens())
      .finally(() => setIsInitializing(false))
    // Runs once on mount only — a deliberate exception to the
    // exhaustive-deps rule, not an oversight. This must fire exactly once
    // per page load to attempt silent restoration; re-running on token
    // changes would try to "restore" a session that already just changed
    // (e.g. immediately after login or logout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAuthenticated = user !== null
  const profileQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.getMe(),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  })

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password)
    setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken })
  }, [])

  const logout = useCallback(async () => {
    const { refreshToken } = getTokens()
    clearTokens()
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken)
      } catch {
        // Token is already cleared client-side regardless — a failed
        // revocation call shouldn't block the user from leaving.
      }
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: profileQuery.data ?? null,
        isAuthenticated,
        isInitializing,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
