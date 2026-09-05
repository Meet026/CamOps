import axios from 'axios'

// The video-stream relay (AI Registry/video-stream) is a separate deployed
// service from Model 1 and from vehicle-detection — its own axios instance,
// its own base URL, and deliberately NO auth interceptor: that service has
// no authentication layer of its own (a real, flagged gap — see
// AI Registry/video-stream/docs/PRD.md Section 10, "Known Gaps"). Model 1's
// apiClient in client.ts must not be reused here since its refresh/
// interceptor logic is specific to Model 1's JWT contract.
const STREAM_API_BASE_URL = import.meta.env.VITE_STREAM_API_BASE_URL ?? 'http://localhost:8100'

export const streamApiClient = axios.create({
  baseURL: STREAM_API_BASE_URL,
})

/** Extracts a human-readable message from video-stream's error shape (FastAPI's default `{detail: string}` — same shape as vehicle-detection's API, different from Model 1's `{message}` shape). */
export function getStreamApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<{ detail?: string }>(error)) {
    return error.response?.data?.detail ?? fallback
  }
  return fallback
}

/** HTTP status code from a video-stream API error, if any — used to distinguish 404 (no stream_path), 500 (ffmpeg failed to start), 502 (camera lookup failed), and 503 (still starting, retry) per the real backend contract (see video-stream/docs/PRD.md Section 7). */
export function getStreamApiErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}

/** The `Retry-After` header (seconds) video-stream sends on a 503 while a stream is still starting. Falls back to 5s — the real value the backend currently always sends — if the header is somehow missing. */
export function getStreamRetryAfterSeconds(error: unknown, fallback = 5): number {
  if (axios.isAxiosError(error)) {
    const header = error.response?.headers?.['retry-after']
    const parsed = Number(header)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}
