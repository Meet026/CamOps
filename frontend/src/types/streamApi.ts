// Shapes match video-stream's real responses exactly — see
// AI Registry/video-stream/docs/PRD.md Section 6 (API Surface) and
// src/api.py / src/camera_lookup.py for the source of truth.

/** One entry from `GET /cameras` — every camera with a real, non-null stream_path. */
export interface StreamCamera {
  camera_id: string
  name: string
  stream_path: string
}

export interface StreamCamerasResponse {
  cameras: StreamCamera[]
}
