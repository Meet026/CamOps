import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Loader2, ShieldAlert, Sparkles, Search } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useVehicleRouteSearch } from '@/hooks/useVehicleSearch'
import { getVehicleApiErrorMessage, getVehicleApiErrorStatus } from '@/api/vehicleClient'
import { getApiErrorMessage } from '@/api/client'
import * as wantedListApi from '@/api/wantedList'
import { searchVehicleNaturalLanguage } from '@/api/vehicles'
import { WantedMatchToast } from '@/components/shared/WantedMatchToast'
import { playWantedMatchAlert } from '@/lib/alert-sound'
import { CropOverlay, DEFAULT_CROP_RECT, cropImageToFile, type CropRect } from './CropOverlay'
import type { VehicleRouteResponse } from '@/types/vehicleApi'
import type { CheckPlateResult } from '@/types/api'

type Step = 'idle' | 'crop' | 'searching'

export function VehicleSearchPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('idle')
  const [stagedPhoto, setStagedPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cropRect, setCropRect] = useState<CropRect>(DEFAULT_CROP_RECT)
  const searchMutation = useVehicleRouteSearch()

  const [plateInput, setPlateInput] = useState('')
  const [plateResult, setPlateResult] = useState<CheckPlateResult | null>(null)
  const [plateError, setPlateError] = useState<string | null>(null)
  const [isCheckingPlate, setIsCheckingPlate] = useState(false)
  const [showMatchToast, setShowMatchToast] = useState(false)

  // Natural language query state
  const [nlQuery, setNlQuery] = useState('')
  const [isNlSearching, setIsNlSearching] = useState(false)
  const [nlError, setNlError] = useState<string | null>(null)

  usePageTitle('Vehicle Search')

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

      const vehicleDescription = [
        res.parsed_query.color,
        res.parsed_query.make,
        res.parsed_query.model || res.parsed_query.vehicle_type,
      ]
        .filter(Boolean)
        .join(' ') || (res.results[0]?.model ? `${res.results[0]?.color ?? ''} ${res.results[0]?.model}`.trim() : 'Vehicle')

      // Transform res to VehicleRouteResponse shape for route results page
      const adaptedResult: VehicleRouteResponse = {
        detections: [{
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
            similarity: sightingScoreMap.get(wp.sighting_id) ?? res.results[idx]?.match_score ?? 0.85
          }))
        }]
      }

      navigate('/vehicle-search/results', {
        state: { 
          result: adaptedResult, 
          nlResponse: res,
          searchedAt: Date.now() 
        },
      })
    } catch (err) {
      setNlError('Natural language search failed. Please verify vehicle-search service is running.')
    } finally {
      setIsNlSearching(false)
    }
  }


  const handleCheckPlate = async () => {
    if (!plateInput.trim()) return
    setIsCheckingPlate(true)
    setPlateError(null)
    setPlateResult(null)
    try {
      const result = await wantedListApi.checkPlate(plateInput)
      setPlateResult(result)
      if (result.matched) {
        setShowMatchToast(true)
        playWantedMatchAlert()
      }
    } catch (err) {
      setPlateError(getApiErrorMessage(err, 'Could not check this plate right now.'))
    } finally {
      setIsCheckingPlate(false)
    }
  }

  const handlePhotoSelect = (file: File) => {
    setStagedPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
    setCropRect(DEFAULT_CROP_RECT)
    setStep('crop')
    searchMutation.reset()
  }

  const runSearch = async (photoToSend: File) => {
    setStep('searching')
    try {
      const result: VehicleRouteResponse = await searchMutation.mutateAsync(photoToSend)
      // searchedAt stamps when this response was actually produced. The
      // results page renders purely from router state and never
      // re-fetches, so reloading or revisiting that URL replays an old
      // response indefinitely — which genuinely caused a stale route to
      // be reported as a live bug after the backend had already been
      // fixed. The results page uses this to say how old the result is
      // instead of presenting stale data as current.
      navigate('/vehicle-search/results', {
        state: { result, photoPreviewUrl: previewUrl, searchedAt: Date.now() },
      })
    } catch {
      setStep('crop')
    }
  }

  const handleSearchCropped = async () => {
    if (!stagedPhoto) return
    const cropped = await cropImageToFile(stagedPhoto, cropRect)
    await runSearch(cropped)
  }

  const handleSkipCropping = async () => {
    if (!stagedPhoto) return
    await runSearch(stagedPhoto)
  }

  const handleReplacePhoto = () => {
    setStagedPhoto(null)
    setPreviewUrl(null)
    setStep('idle')
    searchMutation.reset()
  }

  const errorStatus = searchMutation.isError ? getVehicleApiErrorStatus(searchMutation.error) : undefined
  const isSearching = step === 'searching'

  return (
    <div className="p-9 pb-[72px]">
      {showMatchToast && plateResult?.wantedVehicle && (
        <WantedMatchToast
          wantedVehicle={plateResult.wantedVehicle}
          onDismiss={() => setShowMatchToast(false)}
        />
      )}
      <div className="mx-auto max-w-[720px]">
        <div className="mb-1.5 flex items-center gap-2.5">
          <p className="text-[22px] font-semibold tracking-tight">Vehicle search</p>
          <span className="rounded-[5px] bg-[var(--color-status-ai-bg)] px-[7px] py-0.5 text-[10.5px] font-semibold text-[var(--color-status-ai)]">
            AI-ASSISTED
          </span>
        </div>
        <p className="mb-6 max-w-[56ch] text-[13.5px] text-[var(--text-secondary)]">
          Upload a photo of one vehicle to search past camera sightings. Results are possible matches
          ranked by visual similarity, not confirmed identifications.
        </p>

        {/* Natural Language Vehicle Search Block */}
        <div className="mb-6 rounded-[10px] border border-[var(--color-brand)]/30 bg-[var(--bg-surface)] p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
            <p className="text-[14px] font-semibold text-[var(--text-primary)]">Natural Language AI Search</p>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Ask Sentinel in natural language using vehicle color, make/model, road/landmark, or time window.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNlSearch()}
              placeholder="e.g. white Wagon R last seen near Vaishnodevi circle SG highway"
              className="h-10 min-w-[280px] flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            />
            <button
              type="button"
              onClick={() => handleNlSearch()}
              disabled={isNlSearching || !nlQuery.trim()}
              className="flex h-10 items-center gap-2 rounded-lg border border-transparent bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isNlSearching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {isNlSearching ? 'Parsing & searching…' : 'AI Search'}
            </button>
          </div>

          {/* Quick preset prompt chips */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--text-secondary)] text-[11.5px]">Try asking:</span>
            {[
              'white Wagon R last seen near Vaishnodevi circle SG highway',
              'black Scorpio near Iskcon circle in last 2 hours',
              'red Swift near Science City'
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setNlQuery(preset)
                  handleNlSearch(preset)
                }}
                className="rounded-md border border-[var(--border-default)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[11.5px] text-[var(--text-secondary)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] transition-colors"
              >
                "{preset}"
              </button>
            ))}
          </div>

          {nlError && <p className="mt-2.5 text-xs text-[var(--color-status-offline)]">{nlError}</p>}
        </div>

        <div className="mb-6 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <p className="text-[13.5px] font-semibold">Check a plate number against the wanted list</p>

          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Exact plate match only — this checks against wanted-list records maintained by departments.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={plateInput}
              onChange={(e) => {
                setPlateInput(e.target.value)
                setPlateResult(null)
                setPlateError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCheckPlate()}
              placeholder="e.g. GJ01AB1234"
              className="h-10 min-w-[200px] flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 font-mono text-sm uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            />
            <button
              type="button"
              onClick={handleCheckPlate}
              disabled={isCheckingPlate || !plateInput.trim()}
              className="flex h-10 items-center gap-2 rounded-lg border border-transparent bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isCheckingPlate && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Check plate
            </button>
          </div>

          {plateError && <p className="mt-3 text-sm text-[var(--color-status-offline)]">{plateError}</p>}

          {plateResult && plateResult.matched && plateResult.wantedVehicle && (
            <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--color-status-offline)]">
              <div className="flex items-center gap-2 bg-[var(--color-status-offline)] px-3.5 py-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-white" />
                <span className="text-[11.5px] font-bold uppercase tracking-wide text-white">
                  Wanted list alert
                </span>
              </div>
              <div className="bg-[var(--color-status-offline-bg)] px-3.5 py-3">
                <p className="font-mono text-[14px] font-semibold tracking-wide">
                  {plateResult.wantedVehicle.plateNumber}
                </p>
                <p className="mt-1 text-[13px] font-medium">{plateResult.wantedVehicle.personName}</p>
                <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                  {plateResult.wantedVehicle.crimeDetails}
                </p>
              </div>
            </div>
          )}

          {plateResult && !plateResult.matched && (
            <p className="mt-3 text-sm text-[var(--color-status-online)]">
              No match — this plate is not on the wanted list.
            </p>
          )}
        </div>

        {step === 'idle' && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-14 text-center">
            <ImagePlus className="h-[26px] w-[26px] text-[var(--text-secondary)]" strokeWidth={1.5} />
            <span className="text-[15px] font-semibold">Drop a vehicle photo, or tap to browse</span>
            <span className="text-[12.5px] text-[var(--text-secondary)]">
              JPG or PNG. One vehicle per photo — you'll crop it in the next step.
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])}
            />
          </label>
        )}

        {(step === 'crop' || step === 'searching') && previewUrl && (
          <div
            className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]"
            style={{ opacity: isSearching ? 0.6 : 1, pointerEvents: isSearching ? 'none' : 'auto' }}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-[18px] py-3.5">
              <div>
                <p className="text-[13.5px] font-semibold">Crop to a single vehicle</p>
                <p className="text-[12.5px] text-[var(--text-secondary)]">
                  Drag the frame so only the vehicle you're searching for is inside it.
                </p>
              </div>
              <span className="font-mono text-xs text-[var(--text-secondary)]">
                {stagedPhoto?.name}
              </span>
            </div>
            <div className="p-[18px]">
              <CropOverlay imageUrl={previewUrl} value={cropRect} onChange={setCropRect} />

              <div className="mt-4 flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={handleSearchCropped}
                  disabled={isSearching}
                  className="flex h-11 flex-1 items-center justify-center gap-2.5 rounded-[10px] border border-transparent bg-[var(--color-brand)] text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isSearching && <Loader2 className="h-[15px] w-[15px] animate-spin" />}
                  {isSearching ? 'Searching sightings…' : 'Search past sightings'}
                </button>
                <button
                  type="button"
                  onClick={handleReplacePhoto}
                  className="flex h-11 items-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-[18px] text-[13.5px] font-medium"
                >
                  Replace photo
                </button>
              </div>
              <button
                type="button"
                onClick={handleSkipCropping}
                disabled={isSearching}
                className="mt-3 w-full text-center text-[12.5px] text-[var(--text-secondary)]"
              >
                Skip cropping — <span className="font-medium text-[var(--color-brand)]">use the full photo</span>
              </button>
            </div>
          </div>
        )}

        {searchMutation.isError && errorStatus === 422 && (
          <div className="mt-3 flex items-start gap-[11px] rounded-[10px] border border-[var(--color-status-offline)]/40 bg-[var(--color-status-offline-bg)] px-[15px] py-[13px]">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-offline)]" />
            <div className="flex-1">
              <p className="text-[13px] font-medium">Couldn't process that photo — try a clearer image.</p>
              <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-secondary)]">
                422 · {getVehicleApiErrorMessage(searchMutation.error, 'DETECTION_FAILED')}
              </p>
            </div>
          </div>
        )}

        {searchMutation.isError && errorStatus === 503 && (
          <div className="mt-3 flex items-center gap-[11px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[15px] py-[13px]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-unknown)]" />
            <div className="flex-1">
              <p className="text-[13px] font-medium">The search service is still starting up — try again in a moment.</p>
              <p className="mt-0.5 font-mono text-[11.5px] text-[var(--text-secondary)]">503 · models loading</p>
            </div>
            <button
              type="button"
              onClick={handleSearchCropped}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-1.5 text-[12.5px] font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {searchMutation.isError && errorStatus !== 422 && errorStatus !== 503 && (
          <div className="mt-3 flex items-start gap-[11px] rounded-[10px] border border-[var(--color-status-offline)]/40 bg-[var(--color-status-offline-bg)] px-[15px] py-[13px]">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-status-offline)]" />
            <p className="text-[13px] font-medium">
              {getVehicleApiErrorMessage(searchMutation.error, "Couldn't process that photo — try a clearer image.")}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
