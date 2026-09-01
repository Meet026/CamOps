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
  detection_confidence: number
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
