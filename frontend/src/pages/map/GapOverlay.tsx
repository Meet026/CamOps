import { Rectangle } from 'react-leaflet'
import type { MapBounds } from '@/types/api'

export function GapOverlay({ gaps }: { gaps: MapBounds[] }) {
  return (
    <>
      {gaps.map((gap, i) => (
        <Rectangle
          key={i}
          bounds={[
            [gap.minLat, gap.minLng],
            [gap.maxLat, gap.maxLng],
          ]}
          pathOptions={{
            // Amber, matching --color-status-unknown (#f59e0b) — hardcoded
            // here since Leaflet's SVG path renderer doesn't reliably
            // resolve CSS custom properties for stroke/fill colors.
            color: '#f59e0b',
            weight: 1,
            fillOpacity: 0.15,
          }}
        />
      ))}
    </>
  )
}
