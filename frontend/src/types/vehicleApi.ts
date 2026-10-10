// Types for the vehicle-detection API (AI Registry's FastAPI service) — a
// separate backend from Model 1, kept in its own file rather than folded
// into types/api.ts so the two contracts never get accidentally coupled
// (Vehicle-ReID-Frontend-PRD.md Section 2.3).

export interface VehicleRouteEntry {
  sighting_id: string
  camera_id: string
  camera_name: string
  latitude: number
  longitude: number
  detected_at: string // ISO 8601
  vehicle_class: string
  similarity: number // 0–1; always 1.0 for a plate match, which is exact rather than scored
  // Only present when both a photo and a plate were searched: which
  // signal found this particular sighting.
  matched_by?: 'photo' | 'plate' | 'photo+plate'
}

export type VehicleFoundBy = 'photo' | 'plate' | 'photo+plate'

export interface VehicleDetectionResult {
  // null for a plate-only search that found no sightings — there is no
  // photo to classify and no stored sighting to read a class from.
  vehicle_class: string | null
  found_by?: VehicleFoundBy
  // null specifically means the backend fell back to embedding the whole
  // uploaded image directly (used_whole_image_fallback === true) --
  // YOLO found zero real detections in it, so there is no genuine
  // confidence score to report. Never a fabricated number standing in
  // for a real one -- see vehicle-detection/src/api.py's own comment on
  // this exact fallback.
  // Absent on a plate-only search (no photo, so no detection was run).
  detection_confidence?: number | null
  used_whole_image_fallback?: boolean
  route?: VehicleRouteEntry[]
  route_threshold_used?: number
  // True when last_seen_camera_id/last_seen_at were both provided on the
  // request and the backend actually ran the spatially-constrained
  // search (sighting_store.find_route_from_anchor) instead of the
  // unconstrained global one -- lets the UI say plainly which kind of
  // search actually produced this result.
  anchored_search?: boolean
  error?: string
}

export interface VehicleRouteResponse {
  detections: VehicleDetectionResult[]
}

export interface VehicleApiHealth {
  status: string
  route_similarity_threshold: number
  embedder_model_path: string
}
