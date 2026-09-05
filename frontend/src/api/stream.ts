import { streamApiClient } from './streamClient'
import type { StreamCamerasResponse } from '@/types/streamApi'

/** Real `GET /cameras` — every camera with a registered stream_path, for the Live Stream picker. */
export async function getStreamableCameras(): Promise<StreamCamerasResponse> {
  const { data } = await streamApiClient.get<StreamCamerasResponse>('/cameras')
  return data
}

/** Real `GET /health` liveness check for the relay itself (used to distinguish "relay is down" from "this one camera failed"). */
export async function getStreamHealth(): Promise<{ status: string }> {
  const { data } = await streamApiClient.get<{ status: string }>('/health')
  return data
}

/** The real HLS playlist URL video-stream serves for a camera — starts ffmpeg on first request, idempotent on every call after. hls.js is pointed at this directly; it is also what the manual polling in useCameraStream fetches before handing off to hls.js, so the 503/Retry-After contract can be observed. */
export function playlistUrl(baseUrl: string, cameraId: string): string {
  return `${baseUrl}/stream/${encodeURIComponent(cameraId)}/index.m3u8`
}
