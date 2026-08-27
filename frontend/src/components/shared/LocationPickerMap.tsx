import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'
import { cn } from '@/lib/utils'

// Vite doesn't resolve Leaflet's default marker image paths automatically —
// fix once, here, so every map in the app that uses the default marker works.
const defaultIcon = L.icon({
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

const GUJARAT_CENTER: [number, number] = [22.5, 71.5]

interface LocationPickerMapProps {
  latitude: number | null
  longitude: number | null
  onChange: (lat: number, lng: number) => void
  readOnly?: boolean
  className?: string
}

function ClickHandler({ onChange, readOnly }: { onChange: (lat: number, lng: number) => void; readOnly?: boolean }) {
  useMapEvents({
    click: (e) => {
      if (readOnly) return
      onChange(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function LocationPickerMap({ latitude, longitude, onChange, readOnly, className }: LocationPickerMapProps) {
  const hasPin = latitude !== null && longitude !== null
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (hasPin && mapRef.current) {
      mapRef.current.panTo([latitude, longitude])
    }
  }, [hasPin, latitude, longitude])

  return (
    <div className={cn('overflow-hidden rounded-[var(--radius-md)]', className)}>
      <MapContainer
        center={hasPin ? [latitude, longitude] : GUJARAT_CENTER}
        zoom={hasPin ? 15 : 7}
        className="h-full w-full"
        ref={mapRef}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <ClickHandler onChange={onChange} readOnly={readOnly} />
        {hasPin && (
          <Marker
            position={[latitude, longitude]}
            icon={defaultIcon}
            draggable={!readOnly}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker
                const pos = marker.getLatLng()
                onChange(pos.lat, pos.lng)
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  )
}
