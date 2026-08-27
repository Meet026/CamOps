import { useEffect } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { MapBounds } from '@/types/api'

export function ViewportTracker({ onBoundsChange }: { onBoundsChange: (bounds: MapBounds) => void }) {
  const map = useMap()

  const emit = () => {
    const b = map.getBounds()
    onBoundsChange({
      minLat: b.getSouth(),
      minLng: b.getWest(),
      maxLat: b.getNorth(),
      maxLng: b.getEast(),
    })
  }

  useEffect(() => {
    emit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useMapEvents({
    moveend: emit,
    zoomend: emit,
  })

  return null
}
