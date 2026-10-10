import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Hash,
  ImagePlus,
  Loader2,
  MapPin,
  Route,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useVehicleRouteSearch } from '@/hooks/useVehicleSearch'
import { useCameraList } from '@/hooks/useCameras'
import { getVehicleApiErrorMessage, getVehicleApiErrorStatus } from '@/api/vehicleClient'
import * as wantedListApi from '@/api/wantedList'
import { searchVehicleNaturalLanguage } from '@/api/vehicles'
import { WantedMatchToast } from '@/components/shared/WantedMatchToast'
import { playWantedMatchAlert } from '@/lib/alert-sound'
import { looksLikeIndianPlate, normalizePlate } from '@/lib/plate'
import { CropOverlay, DEFAULT_CROP_RECT, cropImageToFile, type CropRect } from './CropOverlay'
import type { VehicleRouteResponse } from '@/types/vehicleApi'
import type { WantedVehicle } from '@/types/api'

// Converts a <input type="datetime-local"> value (local time, no
// timezone, e.g. "2026-10-06T14:30") into a real, timezone-aware ISO
// string the backend's last_seen_at actually accepts — the backend
// explicitly rejects a naive timestamp (no offset) as ambiguous, so this
// must never just pass the raw input value through.
function toIsoWithOffset(datetimeLocalValue: string): string {
  return new Date(datetimeLocalValue).toISOString()
}

type Mode = 'trace' | 'describe'

const fieldClass =
  'h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]'

export function VehicleSearchPage() {
  const [mode, setMode] = useState<Mode>('trace')
  usePageTitle('Vehicle Search')

  return (
    <div className="p-4 pb-[72px] sm:p-9">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-1.5 flex items-center gap-2.5">
          <p className="text-[22px] font-semibold tracking-tight">Vehicle search</p>
          <span className="rounded-[5px] bg-[var(--color-status-ai-bg)] px-[7px] py-0.5 text-[10.5px] font-semibold text-[var(--color-status-ai)]">
            AI-ASSISTED
          </span>
        </div>
        <p className="mb-5 max-w-[60ch] text-[13.5px] text-[var(--text-secondary)]">
          Find where a vehicle has been seen across the camera network. Results are possible matches,
          not confirmed identifications.
        </p>

        <div
          role="tablist"
          aria-label="Search mode"
          className="mb-5 flex rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-sunken)] p-1 sm:inline-flex"
        >
          <ModeTab active={mode === 'trace'} onClick={() => setMode('trace')} icon={<Route className="h-3.5 w-3.5" />}>
            Trace a vehicle
          </ModeTab>
          <ModeTab active={mode === 'describe'} onClick={() => setMode('describe')} icon={<Sparkles className="h-3.5 w-3.5" />}>
            Describe it in words
          </ModeTab>
        </div>

        {mode === 'trace' ? <TraceVehicleForm /> : <DescribeVehicleForm />}
      </div>
    </div>
  )
}

function ModeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5"
      style={{
        background: active ? 'var(--bg-surface)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
      }}
    >
      {icon}
      {children}
    </button>
  )
}

function TraceVehicleForm() {
  const navigate = useNavigate()
  const searchMutation = useVehicleRouteSearch()

  const [plateInput, setPlateInput] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cropRect, setCropRect] = useState<CropRect>(DEFAULT_CROP_RECT)
  const [useFullPhoto, setUseFullPhoto] = useState(false)

  const [showLocation, setShowLocation] = useState(false)
  const [lastSeenCameraId, setLastSeenCameraId] = useState('')
  const [lastSeenAtLocal, setLastSeenAtLocal] = useState('')

  const [isSearching, setIsSearching] = useState(false)
  const [wantedVehicle, setWantedVehicle] = useState<WantedVehicle | null>(null)
  const [showMatchToast, setShowMatchToast] = useState(false)

  // Backend caps page size at 100 — a single capped page is enough to
  // populate a picker.
  const { data: cameras } = useCameraList({ limit: 100 })

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const plate = normalizePlate(plateInput)
  const plateLooksWrong = plate.length >= 4 && !looksLikeIndianPlate(plate)
  const hasAnchor = Boolean(lastSeenCameraId && lastSeenAtLocal)
  const anchorIncomplete = Boolean(lastSeenCameraId || lastSeenAtLocal) && !hasAnchor
  const canSearch = (plate.length > 0 || photo !== null) && !isSearching

  const searchLabel = plate && photo ? 'Find by plate + photo' : plate ? 'Find by plate' : photo ? 'Find by photo' : 'Find vehicle'

  const handlePhotoSelect = (file: File) => {
    setPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
    setCropRect(DEFAULT_CROP_RECT)
    setUseFullPhoto(false)
    searchMutation.reset()
  }

  const removePhoto = () => {
    setPhoto(null)
    setPreviewUrl(null)
    searchMutation.reset()
  }

  const runSearch = async () => {
    if (!canSearch) return
    setIsSearching(true)
    setWantedVehicle(null)
    searchMutation.reset()
    try {
      const photoToSend = photo ? (useFullPhoto ? photo : await cropImageToFile(photo, cropRect)) : undefined
      const anchor =
        photo && hasAnchor
          ? { lastSeenCameraId, lastSeenAt: toIsoWithOffset(lastSeenAtLocal) }
          : undefined

      // The wanted-list check is a separate service; its failure must
      // never block the route search, so the two run independently.
      const [routeOutcome, wantedOutcome] = await Promise.allSettled([
        searchMutation.mutateAsync({ photo: photoToSend, licensePlate: plate || undefined, anchor }),
        plate ? wantedListApi.checkPlate(plate) : Promise.resolve(null),
      ])

      const wanted = wantedOutcome.status === 'fulfilled' && wantedOutcome.value?.matched
        ? wantedOutcome.value.wantedVehicle
        : null
      if (wanted) {
        playWantedMatchAlert()
        setWantedVehicle(wanted)
        setShowMatchToast(true)
      }

      if (routeOutcome.status === 'fulfilled') {
        const result: VehicleRouteResponse = routeOutcome.value
        // searchedAt lets the results page say how old a replayed result
        // is — it renders from router state and never re-fetches.
        navigate('/vehicle-search/results', {
          state: {
            result,
            photoPreviewUrl: photo ? previewUrl : null,
            searchedPlate: plate || null,
            wantedVehicle: wanted,
            searchedAt: Date.now(),
          },
        })
      }
    } finally {
      setIsSearching(false)
    }
  }

  const errorStatus = searchMutation.isError ? getVehicleApiErrorStatus(searchMutation.error) : undefined

  return (
    <>
      {showMatchToast && wantedVehicle && (
        <WantedMatchToast wantedVehicle={wantedVehicle} onDismiss={() => setShowMatchToast(false)} />
      )}

      <div
        className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-surface)]"
        style={{ opacity: isSearching ? 0.7 : 1, pointerEvents: isSearching ? 'none' : 'auto' }}
      >
        <div className="border-b border-[var(--border-default)] px-5 py-4">
          <p className="text-[14px] font-semibold">What do you know about the vehicle?</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
            Either one works — giving both is the most reliable.
          </p>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label htmlFor="plate" className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
              <Hash className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              Number plate
            </label>
            <div className="relative">
              <input
                id="plate"
                value={plateInput}
                onChange={(e) => setPlateInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="e.g. GJ01AB1234"
                autoComplete="off"
                spellCheck={false}
                className={`${fieldClass} pr-9 font-mono uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal`}
              />
              {plateInput && (
                <button
                  type="button"
                  aria-label="Clear plate"
                  onClick={() => setPlateInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p
              className="mt-1.5 text-[11.5px]"
              style={{ color: plateLooksWrong ? 'var(--color-status-unknown)' : 'var(--text-secondary)' }}
            >
              {plateLooksWrong
                ? `"${plate}" doesn't look like an Indian plate — check for typos. You can still search.`
                : 'Spaces, dashes and case don’t matter. Also checked against the wanted list.'}
            </p>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
              <ImagePlus className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              Photo
            </p>
            {photo && previewUrl ? (
              <div className="flex h-10 items-center gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] pl-1 pr-2">
                <img src={previewUrl} alt="" className="h-8 w-11 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text-secondary)]">
                  {photo.name}
                </span>
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={removePhoto}
                  className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[13px] text-[var(--text-secondary)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]">
                <ImagePlus className="h-4 w-4" strokeWidth={1.6} />
                Choose a photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])}
                />
              </label>
            )}
            <p className="mt-1.5 text-[11.5px] text-[var(--text-secondary)]">
              JPG or PNG with one vehicle — matched by appearance, no plate needed.
            </p>
          </div>
        </div>

        {photo && previewUrl && (
          <div className="border-t border-[var(--border-default)] px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">
                  {useFullPhoto ? 'Using the full photo' : 'Crop to the vehicle'}
                </p>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  {useFullPhoto
                    ? 'Best when the photo already shows only this vehicle.'
                    : 'Drag the frame so only the vehicle you are searching for is inside it.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUseFullPhoto((v) => !v)}
                className="text-[12.5px] font-medium text-[var(--color-brand)]"
              >
                {useFullPhoto ? 'Crop instead' : 'Use the full photo'}
              </button>
            </div>
            {useFullPhoto ? (
              <img src={previewUrl} alt="Selected vehicle" className="max-h-[320px] w-full rounded-lg object-contain" />
            ) : (
              <CropOverlay imageUrl={previewUrl} value={cropRect} onChange={setCropRect} />
            )}
          </div>
        )}

        <div className="border-t border-[var(--border-default)]">
          <button
            type="button"
            onClick={() => setShowLocation((v) => !v)}
            aria-expanded={showLocation}
            className="flex w-full items-center gap-2 px-5 py-3 text-left"
          >
            <MapPin className="h-4 w-4 text-[var(--text-secondary)]" />
            <span className="flex-1 text-[13px] font-medium">
              Narrow by last-known location
              <span className="ml-1.5 font-normal text-[var(--text-secondary)]">optional</span>
            </span>
            {hasAnchor && photo && (
              <span className="rounded-full bg-[var(--color-status-ai-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-status-ai)]">
                On
              </span>
            )}
            <ChevronDown
              className="h-4 w-4 text-[var(--text-secondary)] transition-transform"
              style={{ transform: showLocation ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {showLocation && (
            <div className="px-5 pb-4">
              <p className="mb-3 text-[12px] text-[var(--text-secondary)]">
                If you know roughly where and when it was last seen, the photo search only considers
                cameras it could realistically have reached since — fewer, more trustworthy matches.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={lastSeenCameraId}
                  onChange={(e) => setLastSeenCameraId(e.target.value)}
                  aria-label="Last seen camera"
                  className={fieldClass}
                >
                  <option value="">Camera…</option>
                  {cameras?.map((camera) => (
                    <option key={camera.cameraId} value={camera.cameraId}>
                      {camera.name}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={lastSeenAtLocal}
                  onChange={(e) => setLastSeenAtLocal(e.target.value)}
                  aria-label="Last seen time"
                  className={fieldClass}
                />
              </div>
              {anchorIncomplete && (
                <p className="mt-2 text-[11.5px] text-[var(--color-status-unknown)]">
                  Pick both a camera and a time — or leave both blank to search everywhere.
                </p>
              )}
              {hasAnchor && !photo && (
                <p className="mt-2 text-[11.5px] text-[var(--color-status-unknown)]">
                  This only narrows photo searches. A plate search already matches the exact vehicle.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-default)] p-5">
          <button
            type="button"
            onClick={runSearch}
            disabled={!canSearch}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] bg-[var(--color-brand)] text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {isSearching ? 'Searching sightings…' : searchLabel}
          </button>
          {!plate && !photo && (
            <p className="mt-2 text-center text-[12px] text-[var(--text-secondary)]">
              Enter a plate or choose a photo to search.
            </p>
          )}
        </div>
      </div>

      {wantedVehicle && searchMutation.isError && (
        <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--color-status-offline)]">
          <div className="flex items-center gap-2 bg-[var(--color-status-offline)] px-3.5 py-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-white" />
            <span className="text-[11.5px] font-bold uppercase tracking-wide text-white">Wanted list alert</span>
          </div>
          <div className="bg-[var(--color-status-offline-bg)] px-3.5 py-3">
            <p className="font-mono text-[14px] font-semibold tracking-wide">{wantedVehicle.plateNumber}</p>
            <p className="mt-1 text-[13px] font-medium">{wantedVehicle.personName}</p>
            <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{wantedVehicle.crimeDetails}</p>
          </div>
        </div>
      )}

      {searchMutation.isError && (
        <SearchErrorBanner status={errorStatus} error={searchMutation.error} onRetry={runSearch} />
      )}
    </>
  )
}

function SearchErrorBanner({
  status,
  error,
  onRetry,
}: {
  status: number | undefined
  error: unknown
  onRetry: () => void
}) {
  if (status === 503) {
    return (
      <div className="mt-3 flex items-center gap-[11px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[15px] py-[13px]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-unknown)]" />
        <div className="flex-1">
          <p className="text-[13px] font-medium">The search service is still starting up — try again in a moment.</p>
          <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-secondary)]">503 · models loading</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-1.5 text-[12.5px] font-medium"
        >
          Retry
        </button>
      </div>
    )
  }

  const title = status === 422 ? "Couldn't process that photo — try a clearer image." : getVehicleApiErrorMessage(error, 'Search failed — please try again.')
  return (
    <div className="mt-3 flex items-start gap-[11px] rounded-[10px] border border-[var(--color-status-offline)]/40 bg-[var(--color-status-offline-bg)] px-[15px] py-[13px]">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-offline)]" />
      <div className="flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        {status === 422 && (
          <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-secondary)]">
            422 · {getVehicleApiErrorMessage(error, 'DETECTION_FAILED')}
          </p>
        )}
      </div>
    </div>
  )
}

const NL_PRESETS = [
  'white Wagon R last seen near Vaishnodevi circle SG highway',
  'black Scorpio near Iskcon circle in last 2 hours',
  'red Swift near Science City',
]

function DescribeVehicleForm() {
  const navigate = useNavigate()
  const [nlQuery, setNlQuery] = useState('')
  const [isNlSearching, setIsNlSearching] = useState(false)
  const [nlError, setNlError] = useState<string | null>(null)

  const handleNlSearch = async (queryText?: string) => {
    const q = (queryText ?? nlQuery).trim()
    if (!q) return
    setIsNlSearching(true)
    setNlError(null)
    try {
      const res = await searchVehicleNaturalLanguage(q)
      const sightingScoreMap = new Map<string, number>()
      for (const item of res.results) {
        sightingScoreMap.set(item.id, item.match_score)
      }

      const vehicleDescription =
        [res.parsed_query.color, res.parsed_query.make, res.parsed_query.model || res.parsed_query.vehicle_type]
          .filter(Boolean)
          .join(' ') ||
        (res.results[0]?.model ? `${res.results[0]?.color ?? ''} ${res.results[0]?.model}`.trim() : 'Vehicle')

      // Adapted to the route-results shape so both search modes share one
      // results screen.
      const adaptedResult: VehicleRouteResponse = {
        detections: [
          {
            vehicle_class: vehicleDescription,
            detection_confidence: res.results[0]?.match_score ?? 0.88,
            used_whole_image_fallback: false,
            route: (res.route?.waypoints ?? []).map((wp, idx) => ({
              sighting_id: wp.sighting_id,
              camera_id: wp.camera_id,
              camera_name: wp.camera_name,
              latitude: wp.latitude,
              longitude: wp.longitude,
              detected_at: wp.timestamp ?? new Date().toISOString(),
              vehicle_class: vehicleDescription,
              similarity: sightingScoreMap.get(wp.sighting_id) ?? res.results[idx]?.match_score ?? 0.85,
            })),
          },
        ],
      }

      navigate('/vehicle-search/results', {
        state: { result: adaptedResult, nlResponse: res, photoPreviewUrl: null, searchedAt: Date.now() },
      })
    } catch {
      setNlError('Natural language search failed. Please verify the vehicle-search service is running.')
    } finally {
      setIsNlSearching(false)
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
      <p className="text-[14px] font-semibold">Describe the vehicle</p>
      <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
        Use colour, make or model, a road or landmark, and a time window.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={nlQuery}
          onChange={(e) => setNlQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleNlSearch()}
          placeholder="e.g. white Wagon R near Vaishnodevi circle"
          className={`${fieldClass} min-w-[260px] flex-1`}
        />
        <button
          type="button"
          onClick={() => handleNlSearch()}
          disabled={isNlSearching || !nlQuery.trim()}
          className="flex h-10 items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isNlSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {isNlSearching ? 'Searching…' : 'Search'}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-[var(--text-secondary)]">Try:</span>
        {NL_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setNlQuery(preset)
              handleNlSearch(preset)
            }}
            className="rounded-md border border-[var(--border-default)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
          >
            {preset}
          </button>
        ))}
      </div>
      {nlError && <p className="mt-2.5 text-xs text-[var(--color-status-offline)]">{nlError}</p>}
    </div>
  )
}
