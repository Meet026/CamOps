import { useCallback, useState } from 'react'
import type { MapBounds } from '@/types/api'

/**
 * Tracks the current map viewport as a debounced bounding box — only
 * updates (and thus only triggers a refetch) once panning/zooming has
 * settled, matching the PRD's explicit performance requirement to avoid
 * sending all cameras statewide on every pan/zoom.
 */
export function useMapViewportQuery() {
  const [bounds, setBounds] = useState<MapBounds | null>(null)

  const onBoundsChange = useCallback((next: MapBounds) => {
    setBounds(next)
  }, [])

  return { bounds, onBoundsChange }
}
