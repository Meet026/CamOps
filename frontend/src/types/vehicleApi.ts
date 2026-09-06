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
  similarity: number // 0–1
}

export interface VehicleDetectionResult {
  vehicle_class: string
  // null specifically means the backend fell back to embedding the whole
  // uploaded image directly (used_whole_image_fallback === true) --
  // YOLO found zero real detections in it, so there is no genuine
  // confidence score to report. Never a fabricated number standing in
  // for a real one -- see vehicle-detection/src/api.py's own comment on
  // this exact fallback.
  detection_confidence: number | null
  used_whole_image_fallback: boolean
  route?: VehicleRouteEntry[]
  route_threshold_used?: number
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
