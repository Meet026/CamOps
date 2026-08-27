import { apiClient } from './client'
import type { CameraPin, GapAnalysisResult, HeatmapResult, MapBounds } from '@/types/api'

export async function getCamerasInBounds(bounds: MapBounds): Promise<CameraPin[]> {
  const response = await apiClient.get<CameraPin[]>('/gis/cameras-in-bounds', { params: bounds })
  return response.data
}

export async function getGapAnalysis(
  bounds: MapBounds,
  gridSize?: number,
): Promise<GapAnalysisResult> {
  const response = await apiClient.get<GapAnalysisResult>('/gis/gap-analysis', {
    params: { ...bounds, gridSize },
  })
  return response.data
}

export async function getHeatmap(): Promise<HeatmapResult> {
  const response = await apiClient.get<HeatmapResult>('/gis/heatmap')
  return response.data
}
