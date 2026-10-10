import axios from 'axios'
import { vehicleApiClient } from './vehicleClient'
import type { VehicleApiHealth, VehicleRouteResponse } from '@/types/vehicleApi'

const VEHICLE_SEARCH_SERVICE_URL = import.meta.env.VITE_VEHICLE_SEARCH_SERVICE_URL ?? 'http://localhost:8300'

export const vehicleSearchClient = axios.create({
  baseURL: VEHICLE_SEARCH_SERVICE_URL,
})

export interface NaturalLanguageSearchResponse {
  query_id: string
  total: number
  results: Array<{
    id: string
    camera_id: string
    camera_name: string
    camera_location?: string
    timestamp?: string
    license_plate?: string
    plate_confidence: number
    vehicle_type?: string
    color?: string
    make?: string
    model?: string
    crop_url?: string
    full_frame_url?: string
    match_score: number
    match_reasons: string[]
  }>
  parsed_query: {
    raw_query: string
    color?: string
    vehicle_type?: string
    make?: string
    model?: string
    plate_pattern?: string
    location_text?: string
    confidence: number
  }
  route?: {
    vehicle_id: string
    total_sightings: number
    waypoints: Array<{
      sighting_id: string
      camera_id: string
      camera_name: string
      timestamp?: string
      latitude: number
      longitude: number
      crop_url?: string
      license_plate?: string
    }>
    segments: Array<{
      from_camera_id: string
      to_camera_id: string
      travel_time_minutes: number
      estimated_speed_kmh: number
    }>
    duration_minutes: number
  }
  execution_time_ms: number
}

// Both optional, and only meaningful together — the backend rejects one
// without the other (400). lastSeenAt must be a timezone-aware ISO 8601
// string; Date#toISOString() already produces one (always UTC, with a
// 'Z' offset), so passing that through directly satisfies the backend's
// requirement without any extra formatting here.
export interface VehicleRouteSearchAnchor {
  lastSeenCameraId: string
  lastSeenAt: string
}

export async function searchVehicleRoute(
  photo: File,
  anchor?: VehicleRouteSearchAnchor,
): Promise<VehicleRouteResponse> {
  const formData = new FormData()
  formData.append('photo', photo)
  if (anchor) {
    formData.append('last_seen_camera_id', anchor.lastSeenCameraId)
    formData.append('last_seen_at', anchor.lastSeenAt)
  }
  const response = await vehicleApiClient.post<VehicleRouteResponse>('/vehicles/route', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export async function searchVehicleNaturalLanguage(query: string): Promise<NaturalLanguageSearchResponse> {
  const response = await vehicleSearchClient.post<NaturalLanguageSearchResponse>('/api/v1/search', {
    query,
    include_route: true,
    limit: 20
  })
  return response.data
}

export async function getVehicleApiHealth(): Promise<VehicleApiHealth> {
  const response = await vehicleApiClient.get<VehicleApiHealth>('/health')
  return response.data
}

