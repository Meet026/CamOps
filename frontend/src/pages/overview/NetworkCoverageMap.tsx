import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import { CameraPinMarker } from '@/pages/map/CameraPinMarker'
import * as gisApi from '@/api/gis'
import type { MapBounds } from '@/types/api'

// Real Gujarat bounding box — wide enough to show every real camera
// location this project has ever seeded (Ahmedabad, Surat, Vadodara,
// Rajkot, Gandhinagar and beyond), fixed rather than viewport-tracked since
// this mini-map is deliberately non-interactive.
const GUJARAT_BOUNDS: MapBounds = { minLat: 20.0, maxLat: 24.8, minLng: 68.0, maxLng: 74.5 }
const GUJARAT_CENTER: [number, number] = [22.6, 71.7]

// The reference design (Sentinel.dc.html) shows a real live map on Overview
// by default — "Network coverage", 260px tall, non-interactive, click-through
// to the full Map page. This was previously a clickable text card with no
// actual map rendered; this component is the real thing, reusing the same
// CameraPinMarker used on the full GIS map so status colors/popups match.
export function NetworkCoverageMap() {
  const navigate = useNavigate()

  const pinsQuery = useQuery({
    queryKey: ['gis', 'cameras-in-bounds', GUJARAT_BOUNDS],
    queryFn: () => gisApi.getCamerasInBounds(GUJARAT_BOUNDS),
  })

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-[18px] py-3.5">
        <p className="text-base font-semibold">Network coverage</p>
        <button
          onClick={() => navigate('/map')}
          className="text-[12.5px] font-medium text-[var(--color-brand)] hover:underline">
          View full map →
        </button>
      </div>
      <div onClick={() => navigate('/map')} className="h-[260px] cursor-pointer">
        <MapContainer
          center={GUJARAT_CENTER}
          zoom={6}
          zoomControl={false}
          dragging={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          keyboard={false}
          attributionControl={false}
          className="h-full w-full">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {pinsQuery.data?.map((pin) => (
            <CameraPinMarker key={pin.cameraId} pin={pin} colorMode="status" />
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
