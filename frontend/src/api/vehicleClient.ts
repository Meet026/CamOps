import axios from 'axios'

// The vehicle-detection API is a separate deployed service from Model 1
// (see AI Registry's architecture decision) — its own axios instance,
// its own base URL, and deliberately NO auth interceptor: that service
// has no authentication layer of its own yet (a real, flagged gap — see
// Vehicle-ReID-Frontend-PRD.md Section 7). Model 1's apiClient in
// client.ts must not be reused here since its refresh/interceptor logic
// is specific to Model 1's JWT contract.
const VEHICLE_API_BASE_URL = import.meta.env.VITE_VEHICLE_API_BASE_URL ?? 'http://localhost:8000'

export const vehicleApiClient = axios.create({
  baseURL: VEHICLE_API_BASE_URL,
})

/** Extracts a human-readable message from the vehicle-detection API's error shape (FastAPI's default `{detail: string}` — different from Model 1's `{message}` shape, so this can't reuse getApiErrorMessage). */
export function getVehicleApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError<{ detail?: string }>(error)) {
    return error.response?.data?.detail ?? fallback
  }
  return fallback
}

/** HTTP status code from a vehicle-detection API error, if any — used to distinguish 422 (detection failed) from 503 (models still loading), per the design's distinct error treatments for each. */
export function getVehicleApiErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) {
    return error.response?.status
  }
  return undefined
}
