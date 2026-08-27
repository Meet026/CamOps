import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import type { HeatmapPoint } from '@/types/api'

export function HeatmapLayer({ points }: { points: HeatmapPoint[] }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return

    const layer = L.heatLayer(
      points.map((p) => [p.latitude, p.longitude, p.weight]),
      { radius: 35, blur: 25, maxZoom: 12 },
    )
    layer.addTo(map)

    return () => {
      map.removeLayer(layer)
    }
  }, [map, points])

  return null
}
