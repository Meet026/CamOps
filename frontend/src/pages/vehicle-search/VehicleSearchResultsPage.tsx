import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { format } from 'date-fns'
import { Car, MapPin, Search } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { EmptyState } from '@/components/shared/EmptyState'
import type { VehicleDetectionResult, VehicleRouteEntry, VehicleRouteResponse } from '@/types/vehicleApi'

const GUJARAT_CENTER: [number, number] = [22.5, 71.5]

interface LocationState {
  result: VehicleRouteResponse
  photoPreviewUrl: string | null
  /** Epoch ms when this response was actually produced — see StaleResultNotice. */
  searchedAt?: number
}

// How old a result can be before we say so. This page renders entirely
// from router state and never re-fetches, so a reload or a revisit
// replays the same response forever. That is not hypothetical: a route
// from before a backend fix was reported as still-broken because the
// screen never changed. Surfacing the age makes that impossible to
// mistake for live data.
const STALE_RESULT_AFTER_MS = 2 * 60 * 1000

function StaleResultNotice({ searchedAt, onNewSearch }: { searchedAt?: number; onNewSearch: () => void }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  if (searchedAt === undefined) {
    // Pre-dates the searchedAt field (e.g. a tab left open across the
    // deploy that added it) — age is genuinely unknown, so say that
    // rather than guess.
    return (
      <StaleBanner onNewSearch={onNewSearch}>
        These results were loaded earlier in this session and are not being refreshed.
      </StaleBanner>
    )
  }

  const ageMs = now - searchedAt
  if (ageMs < STALE_RESULT_AFTER_MS) return null

  const minutes = Math.floor(ageMs / 60_000)
  return (
    <StaleBanner onNewSearch={onNewSearch}>
      These results are {minutes} minute{minutes === 1 ? '' : 's'} old and are not refreshed
      automatically.
    </StaleBanner>
  )
}

function StaleBanner({ children, onNewSearch }: { children: React.ReactNode; onNewSearch: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] bg-[var(--color-status-unknown-bg)] px-6 py-2.5 text-[12.5px] text-[var(--text-primary)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-status-unknown)]" />
      <span>{children}</span>
      <button
        onClick={onNewSearch}
        className="font-semibold text-[var(--color-brand)] underline-offset-2 hover:underline"
      >
        Run a new search
      </button>
    </div>
  )
}

interface Band {
  band: string
  fg: string
  bg: string
  raw: string
}

// Pixel-matched to the reference (Sentinel.dc.html): the same three
// similarity bands, thresholds, and colors as the design's own band()
// helper — not invented here.
function band(similarity: number): Band {
  const pct = similarity * 100
  if (pct >= 90) return { band: 'Strong match', fg: 'var(--color-status-online)', bg: 'var(--color-status-online-bg)', raw: '#22C55E' }
  if (pct >= 80) return { band: 'Possible match', fg: 'var(--color-status-ai)', bg: 'var(--color-status-ai-bg)', raw: '#A855F7' }
  return { band: 'Weak match — review carefully', fg: 'var(--color-status-unknown)', bg: 'var(--color-status-unknown-bg)', raw: '#F59E0B' }
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000)
}

function spanLabel(route: VehicleRouteEntry[]): string {
  if (route.length < 2) return '0 min'
  const mins = minutesBetween(route[route.length - 1].detected_at, route[0].detected_at)
  return mins + ' min'
}

// Vehicle Search Results — pixel-matched to the reference's `at.vresults`
// screen: header bar, multi-vehicle warning, per-vehicle groups each with
// a connector-line timeline (selectable stops) beside a route map (dashed
// polyline, numbered markers, floating glass stat card + legend), and the
// design's exact distinct empty/error states — never collapsed into one
// generic "no results" state.
export function VehicleSearchResultsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null

  usePageTitle('Vehicle Search — Results')

  if (!state?.result) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Car}
          title="No search results to show"
          description="Start a new search to find a vehicle's route."
          action={<NewSearchButton onClick={() => navigate('/vehicle-search')} />}
        />
      </div>
    )
  }

  const { result, photoPreviewUrl } = state
  const detections = result.detections

  if (detections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <EmptyDetail
          icon={<VehicleOffIcon />}
          tone="warning"
          title="No vehicle detected in that photo"
          description="Try a clearer or closer crop — the vehicle should fill most of the frame."
          actionLabel="Upload another photo"
          onAction={() => navigate('/vehicle-search')}
        />
      </div>
    )
  }

  // "Happy path" is one detection with a route; the design's per-group
  // header only shows when there's more than one vehicle to disambiguate.
  const showGroupHeaders = detections.length > 1
  const first = detections[0]
  const primaryRoute = first.route ?? []

  return (
    <div className="flex h-full flex-col">
      <ResultsHeader
        detection={first}
        photoPreviewUrl={photoPreviewUrl}
        onNewSearch={() => navigate('/vehicle-search')}
      />

      <StaleResultNotice
        searchedAt={state.searchedAt}
        onNewSearch={() => navigate('/vehicle-search')}
      />

      {detections.length > 1 && (
        <div className="flex items-start gap-[11px] border-b border-[var(--border-default)] bg-[var(--color-status-unknown-bg)] px-6 py-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-unknown)]" />
          <p className="text-[13px]">
            This photo appears to contain more than one vehicle — results may be unreliable.{' '}
            <span className="text-[var(--text-secondary)]">For best results, crop closely to a single vehicle.</span>
          </p>
        </div>
      )}

      {detections.length === 1 && primaryRoute.length === 0 && !first.error ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <EmptyDetail
            icon={<Search className="h-5 w-5" />}
            tone="neutral"
            title={`No past sightings above ${Math.round((first.route_threshold_used ?? 0.8) * 100)}% similarity`}
            description="The vehicle was read from the photo, but nothing in the sighting database cleared the threshold. This is a normal outcome, not an error."
            actionLabel="Try another photo"
            onAction={() => navigate('/vehicle-search')}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: 'minmax(340px,40%) 1fr' }}>
          <div className="overflow-auto border-r border-[var(--border-default)] px-[22px] py-5 pb-8">
            {detections.map((detection, i) => (
              <DetectionGroup key={i} detection={detection} showHeader={showGroupHeaders} />
            ))}
            <p className="text-xs text-[var(--text-secondary)]" style={{ textWrap: 'pretty' }}>
              Sightings above the current similarity threshold, in time order. Misses are possible — this
              is not a complete movement history.
            </p>
          </div>
          <RoutePanel route={primaryRoute} />
        </div>
      )}
    </div>
  )
}

function NewSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3.5 py-2 text-[13px] font-medium"
    >
      New search
    </button>
  )
}

function ResultsHeader({
  detection,
  photoPreviewUrl,
  onNewSearch,
}: {
  detection: VehicleDetectionResult
  photoPreviewUrl: string | null
  onNewSearch: () => void
}) {
  const thresholdPct = Math.round((detection.route_threshold_used ?? 0.8) * 100)
  return (
    <div className="flex flex-none flex-wrap items-center gap-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-4">
      <div className="flex h-12 w-16 flex-none items-center justify-center overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-sunken)] text-[var(--text-secondary)]">
        {photoPreviewUrl ? (
          <img src={photoPreviewUrl} alt="Searched vehicle" className="h-full w-full object-cover" />
        ) : (
          <Car className="h-[18px] w-[18px]" strokeWidth={1.5} />
        )}
      </div>
      <div className="min-w-[240px] flex-1 basis-[280px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[15px] font-semibold capitalize">{detection.vehicle_class}</span>
          <span className="rounded-full bg-[var(--bg-surface-sunken)] px-2.5 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
            {detection.used_whole_image_fallback
              ? 'used whole photo (no vehicle boundary found)'
              : `detection ${detection.detection_confidence?.toFixed(2)}`}
          </span>
        </div>
        <p className="mt-px text-[12.5px] text-[var(--text-secondary)]">
          Showing sightings ≥ {thresholdPct}% similar · possible matches, not confirmed identifications
        </p>
      </div>
      <NewSearchButton onClick={onNewSearch} />
    </div>
  )
}

function DetectionGroup({ detection, showHeader }: { detection: VehicleDetectionResult; showHeader: boolean }) {
  const [selected, setSelected] = useState(0)

  return (
    <div className="mb-[22px]">
      {showHeader && (
        <div className="mb-3 flex items-center gap-2.5">
          <span className="rounded-full bg-[var(--bg-surface-sunken)] px-2.5 py-0.5 text-xs font-semibold text-[var(--text-secondary)] capitalize">
            {detection.vehicle_class}
          </span>
          <span className="font-mono text-[11.5px] text-[var(--text-secondary)]">
            {detection.used_whole_image_fallback
              ? 'used whole photo (no vehicle boundary found)'
              : `detection ${detection.detection_confidence?.toFixed(2)}`}
          </span>
        </div>
      )}

      {detection.error && (
        <div className="flex items-start gap-[11px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[15px] py-[13px]">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-offline)]" />
          <div>
            <p className="text-[13px] font-medium">Couldn't generate a fingerprint for this vehicle</p>
            <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-secondary)]">{detection.error}</p>
          </div>
        </div>
      )}

      {!detection.error && (detection.route ?? []).length === 0 && showHeader && (
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[15px] py-3 text-[12.5px] text-[var(--text-secondary)]">
          No sightings above the threshold for this vehicle.
        </div>
      )}

      {(detection.route ?? []).map((stop, i, arr) => {
        const b = band(stop.similarity)
        const isSelected = selected === i
        const prev = arr[i - 1]
        const gap = prev ? '+' + minutesBetween(stop.detected_at, prev.detected_at) + ' min' : 'start'
        const pct = Math.round(stop.similarity * 100) + '%'

        return (
          <div key={stop.sighting_id} className="relative flex cursor-pointer gap-3.5" onClick={() => setSelected(i)}>
            <div className="flex w-7 flex-none flex-col items-center">
              <span
                className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-xs font-semibold transition-all duration-150"
                style={{
                  background: isSelected ? b.fg : 'var(--bg-surface-sunken)',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${isSelected ? b.fg : 'var(--border-default)'}`,
                }}
              >
                {i + 1}
              </span>
              {i < arr.length - 1 && <span className="min-h-3 w-px flex-1 bg-[var(--border-default)]" />}
            </div>
            <div className="min-w-0 flex-1 pb-[18px]">
              <div
                className="rounded-[10px] border px-[15px] py-3.5 transition-colors duration-150"
                style={{
                  borderColor: isSelected ? 'var(--color-brand-border)' : 'var(--border-default)',
                  background: isSelected ? 'var(--bg-surface-raised)' : 'var(--bg-surface)',
                }}
              >
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold" style={{ textWrap: 'pretty' }}>
                      {stop.camera_name}
                    </p>
                    <p className="mt-[3px] font-mono text-xs text-[var(--text-secondary)]">
                      {format(new Date(stop.detected_at), 'yyyy-MM-dd HH:mm:ss')} IST
                    </p>
                  </div>
                  <span
                    className="flex-none rounded-full px-2.5 py-[3px] text-xs font-semibold"
                    style={{ background: b.bg, color: b.fg }}
                  >
                    {pct}
                  </span>
                </div>
                <div className="mt-[9px] flex items-center gap-2">
                  <span className="text-[11.5px] font-medium" style={{ color: b.fg }}>
                    {b.band}
                  </span>
                  <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--bg-surface-sunken)]">
                    <span className="block h-full opacity-75" style={{ width: pct, background: b.fg }} />
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-secondary)]">{gap}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RoutePanel({ route }: { route: VehicleRouteEntry[] }) {
  if (route.length === 0) {
    return (
      <div className="relative min-w-0 bg-[var(--bg-surface-raised)]">
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-[300px] text-center">
            <span className="mb-3 inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[var(--bg-surface-sunken)] text-[var(--text-secondary)]">
              <MapPin className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <p className="text-[13.5px] font-semibold">No route to plot</p>
            <p className="mt-[3px] text-[12.5px] text-[var(--text-secondary)]" style={{ textWrap: 'pretty' }}>
              No sightings were returned for this detection, so there is nothing to place on the map.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const span = spanLabel(route)

  return (
    <div className="relative min-w-0">
      <MapContainer center={GUJARAT_CENTER} zoom={12} className="h-full w-full" style={{ position: 'absolute', inset: 0 }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <RouteLayer route={route} />
      </MapContainer>

      <div className="absolute left-4 top-4 z-[1000] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-glass)] px-3.5 py-[11px] shadow-[var(--shadow-float)] backdrop-blur-[14px]">
        <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Reconstructed route
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">{route.length}</span>
          <span className="text-[12.5px] text-[var(--text-secondary)]">sightings · {span}</span>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-[1000] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-glass)] px-[13px] py-2.5 shadow-[var(--shadow-float)] backdrop-blur-[14px]">
        <LegendRow color="#22C55E" label="Strong match · ≥90%" />
        <LegendRow color="#A855F7" label="Possible match · 80–89%" />
        <LegendRow color="#5B5FEF" label="Chronological route" />
      </div>
    </div>
  )
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-[9px] py-[3px] text-[12.5px] text-[var(--text-secondary)]">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </div>
  )
}

// Real bug this fixes: a vehicle revisiting the same camera repeatedly
// (confirmed directly against live data — one camera showed up to 279
// sightings) means many stops share the EXACT same lat/lng. Leaflet
// draws later markers directly on top of earlier ones at an identical
// pixel position, so only the last-drawn stop was ever visible — the
// route's own polyline and left-hand timeline both correctly showed
// every stop, only the map silently hid all but one marker per location.
// Fix: group stops by real coordinate, and nudge every repeat visit to
// that same coordinate outward in a small spiral (in fixed SCREEN
// pixels, not lat/lng degrees, via the map's own pixel<->latlng
// conversion — so the offset looks the same size at any zoom level
// instead of vanishing when zoomed in or exploding when zoomed out).
// The single-visit case (the overwhelming majority of real cameras) is
// completely unaffected — zero offset, exactly the original position.
const SPIRAL_OFFSET_PX = 14 // px between each stacked marker's ring

function offsetLatLngForIndex(map: L.Map, lat: number, lng: number, indexAtThisPoint: number): [number, number] {
  if (indexAtThisPoint === 0) return [lat, lng]
  const angle = indexAtThisPoint * 2.4 // radians; irrational-ish step spreads points around the circle instead of overlapping on a diameter
  const radius = SPIRAL_OFFSET_PX * Math.sqrt(indexAtThisPoint) // sqrt spacing keeps rings evenly dense as the count grows
  const center = map.latLngToLayerPoint([lat, lng])
  const offsetPoint = L.point(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle))
  const offsetLatLng = map.layerPointToLatLng(offsetPoint)
  return [offsetLatLng.lat, offsetLatLng.lng]
}

// Draws the dashed route polyline + numbered circular markers to match the
// design's drawRoute() exactly (dash pattern, marker sizing, fitBounds
// with 0.25 padding) — done imperatively via the Leaflet instance since
// react-leaflet has no declarative divIcon marker primitive for this.
function RouteLayer({ route }: { route: VehicleRouteEntry[] }) {
  const map = useMap()

  useEffect(() => {
    const positions: [number, number][] = route.map((r) => [r.latitude, r.longitude])
    const layerGroup = L.layerGroup().addTo(map)

    layerGroup.addLayer(
      L.polyline(positions, { color: '#5B5FEF', weight: 2.5, opacity: 0.85, dashArray: '1 7', lineCap: 'round' }),
    )

    // How many stops before this one share the exact same coordinate —
    // determines this stop's position in the spiral around that point.
    const seenAtCoordinate = new Map<string, number>()

    route.forEach((stop, i) => {
      const coordKey = `${stop.latitude},${stop.longitude}`
      const indexAtThisPoint = seenAtCoordinate.get(coordKey) ?? 0
      seenAtCoordinate.set(coordKey, indexAtThisPoint + 1)
      const [markerLat, markerLng] = offsetLatLngForIndex(map, stop.latitude, stop.longitude, indexAtThisPoint)

      const b = band(stop.similarity)
      const size = 24
      const html =
        `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${b.raw};` +
        `color:#fff;border:2px solid rgba(255,255,255,.6);box-shadow:0 2px 10px rgba(0,0,0,.45);` +
        `display:flex;align-items:center;justify-content:center;font:600 11px/1 Inter,sans-serif">${i + 1}</div>`
      const marker = L.marker([markerLat, markerLng], {
        icon: L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      })
      marker.bindTooltip(
        `${stop.camera_name} · ${Math.round(stop.similarity * 100)}% · ${format(new Date(stop.detected_at), 'HH:mm:ss')}`,
        { direction: 'top', offset: [0, -10] },
      )
      layerGroup.addLayer(marker)
    })

    if (positions.length > 0) {
      map.fitBounds(L.latLngBounds(positions).pad(0.25), { animate: false })
    }

    return () => {
      layerGroup.remove()
    }
  }, [map, route])

  return null
}

function VehicleOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M12 8v5M12 16.5v.5" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function EmptyDetail({
  icon,
  tone,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode
  tone: 'neutral' | 'warning'
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="max-w-[420px] text-center">
      <span
        className="mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-full"
        style={{
          background: tone === 'warning' ? 'var(--color-status-unknown-bg)' : 'var(--bg-surface-sunken)',
          color: tone === 'warning' ? 'var(--color-status-unknown)' : 'var(--text-secondary)',
        }}
      >
        {icon}
      </span>
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mt-[5px] text-[13px] text-[var(--text-secondary)]" style={{ textWrap: 'pretty' }}>
        {description}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="mt-[18px] inline-block rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2.5 text-[13px] font-medium"
      >
        {actionLabel}
      </button>
    </div>
  )
}
