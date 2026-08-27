import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'

// Gujarat's approximate geographic center — the login backdrop pans slowly
// around this region as a taste of the product before the user is even in
// it (PRD Section 4.1).
const GUJARAT_CENTER: [number, number] = [22.5, 71.5]
const PAN_RADIUS_DEGREES = 0.6
const PAN_DURATION_MS = 45000

export function MapBackdrop() {
  const mapRef = useRef<LeafletMap | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let frame: number
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = (now - start) % PAN_DURATION_MS
      const angle = (elapsed / PAN_DURATION_MS) * Math.PI * 2
      const lat = GUJARAT_CENTER[0] + Math.sin(angle) * PAN_RADIUS_DEGREES * 0.4
      const lng = GUJARAT_CENTER[1] + Math.cos(angle) * PAN_RADIUS_DEGREES
      map.panTo([lat, lng], { animate: false, noMoveStart: true })
      frame = requestAnimationFrame(tick)
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prefersReducedMotion) {
      frame = requestAnimationFrame(tick)
    }

    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={GUJARAT_CENTER}
        zoom={7}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        className="h-full w-full grayscale"
        ref={mapRef}
      >
        {/* Standard OSM tiles — no API key required. The grayscale filter
            above + the dark gradient overlay below do the desaturating/
            darkening work that a dedicated dark tile provider would
            otherwise handle. */}
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      </MapContainer>
      {/* Darken + vignette so the form panel's contrast never competes with the map */}
      <div className="absolute inset-0 bg-gradient-to-l from-black/20 via-black/40 to-[var(--bg-canvas)]" />
    </div>
  )
}
