import type { AppRole } from '@/types/api'

interface JwtPayload {
  sub: string
  role: AppRole
  departmentId: string | null
  iat: number
  exp: number
}

/**
 * Decodes a JWT's payload WITHOUT verifying its signature — the frontend
 * never needs to verify a token it received directly from the backend over
 * HTTPS; verification is the backend's job on every subsequent request.
 * This is purely for reading `sub`/`role`/`departmentId` out of an access
 * token to populate the auth context, since no /auth/me endpoint exists
 * (see BACKEND_GAPS.md #10).
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payloadSegment] = token.split('.')
    if (!payloadSegment) return null
    const json = atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload) return true
  return payload.exp * 1000 <= Date.now()
}

export function getMsUntilExpiry(token: string): number {
  const payload = decodeJwtPayload(token)
  if (!payload) return 0
  return payload.exp * 1000 - Date.now()
}
