/**
 * Token storage, living outside React state so the axios interceptor (a
 * plain module, not a component) can read/write tokens without threading
 * them through props or a hook. AuthContext wraps this with React state
 * for anything that needs to re-render on auth changes (nav visibility,
 * protected routes).
 *
 * Access token: memory-only, never persisted (PRD Section 4.3: XSS surface
 * reduction) — it's the credential that actually unlocks API calls, and
 * it's short-lived (15 min) anyway.
 *
 * Refresh token: persisted to localStorage so a page reload or browser
 * restart doesn't force a re-login. This is the standard tradeoff nearly
 * every SPA makes — on its own, a stolen refresh token is only useful for
 * calling POST /auth/refresh, and a real access token still has to be
 * minted from it before anything else works. The real backend's
 * POST /auth/refresh expects the token in the request body, not an
 * httpOnly cookie (BACKEND_GAPS.md #5), so localStorage is the closest
 * approximation available to persisted-but-not-fully-exposed storage.
 */

const REFRESH_TOKEN_STORAGE_KEY = 'sentinel.refreshToken'

function readPersistedRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)
  } catch {
    // Private browsing / storage disabled — fall back to memory-only.
    return null
  }
}

function persistRefreshToken(refreshToken: string | null): void {
  try {
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken)
    } else {
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    }
  } catch {
    // Same fallback as above — a failed write just means this reload
    // won't be silently restored, not a crash.
  }
}

interface TokenState {
  accessToken: string | null
  refreshToken: string | null
}

let state: TokenState = { accessToken: null, refreshToken: readPersistedRefreshToken() }

const listeners = new Set<() => void>()

export function getTokens(): TokenState {
  return state
}

export function setTokens(next: TokenState): void {
  state = next
  persistRefreshToken(next.refreshToken)
  listeners.forEach((listener) => listener())
}

export function clearTokens(): void {
  setTokens({ accessToken: null, refreshToken: null })
}

export function subscribeToTokenChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
