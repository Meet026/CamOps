import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { clearTokens, getTokens, setTokens } from '@/lib/token-store'
import type { ApiErrorBody, RefreshResponse } from '@/types/api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
})

// Attach the in-memory access token to every outgoing request.
apiClient.interceptors.request.use((config) => {
  const { accessToken } = getTokens()
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// A single in-flight refresh promise shared across every request that hits
// a 401 concurrently, so a burst of parallel requests (e.g. the dashboard
// firing several queries at once) triggers exactly one refresh call, not
// one per request.
let refreshPromise: Promise<string | null> | null = null

async function performRefresh(): Promise<string | null> {
  const { refreshToken } = getTokens()
  if (!refreshToken) return null

  try {
    const response = await axios.post<RefreshResponse>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
    )
    const { accessToken } = response.data
    setTokens({ accessToken, refreshToken })
    return accessToken
  } catch {
    clearTokens()
    return null
  }
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableConfig | undefined

    if (error.response?.status === 401 && original && !original._retried) {
      original._retried = true

      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null
        })
      }

      const newAccessToken = await refreshPromise
      if (newAccessToken) {
        original.headers.Authorization = `Bearer ${newAccessToken}`
        return apiClient(original)
      }

      // Refresh itself failed — the session is genuinely over. Let the
      // caller's error handling proceed; AuthContext listens for this via
      // the token store going empty and redirects to login.
    }

    return Promise.reject(error)
  },
)

/** Extracts a human-readable message from the real backend's error shape. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const message = error.response?.data?.message
    if (Array.isArray(message)) return message.join(', ')
    if (typeof message === 'string') return message
  }
  return fallback
}

export function getApiErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}
