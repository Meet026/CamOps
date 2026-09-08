import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ImagePlus, Loader2 } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useVehicleRouteSearch } from '@/hooks/useVehicleSearch'
import { getVehicleApiErrorMessage, getVehicleApiErrorStatus } from '@/api/vehicleClient'
import { CropOverlay, DEFAULT_CROP_RECT, cropImageToFile, type CropRect } from './CropOverlay'
import {
  DEMO_CAMERAS,
  SEARCH_RADIUS_KM,
  buildCorridorRoute,
  buildRouteResponse,
  buildStages,
  findWatchlistHit,
  normalisePlate,
} from './demoInvestigation'
import { useStagedProcessing } from './useStagedProcessing'
import { playAlertSound } from './alertSound'
import type { VehicleRouteResponse } from '@/types/vehicleApi'

// Pixel-matched to the reference (Sentinel.dc.html) Vehicle Search screen:
// dashed drop zone -> crop step (draggable frame, corner handles,
// rule-of-thirds grid) -> search, with the design's exact copy, the
// "Skip cropping" text link, and its 422/503 error banner treatment.
type Step = 'idle' | 'crop' | 'searching'

// Plate + last-seen camera drive the plate-first investigation flow.
// NOTE FOR MAINTAINERS: that flow is generated client-side rather than
// served by the backend — see demoInvestigation.ts for exactly what is
// computed from real data and what is scripted. Filling either field
// routes the search through it; leaving both empty keeps the original
// photo-only behaviour completely unchanged.

export function VehicleSearchPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('idle')
  const [stagedPhoto, setStagedPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cropRect, setCropRect] = useState<CropRect>(DEFAULT_CROP_RECT)
  const [plate, setPlate] = useState('')
  const [lastSeenCamera, setLastSeenCamera] = useState('')
  const searchMutation = useVehicleRouteSearch()
  const staged = useStagedProcessing()

  usePageTitle('Vehicle Search')

  // Either field opting in is enough — an officer may know the plate but
  // not the camera, or vice versa.
  const useInvestigation = plate.trim().length > 0 || lastSeenCamera.length > 0

  const handlePhotoSelect = (file: File) => {
    setStagedPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
    setCropRect(DEFAULT_CROP_RECT)
    setStep('crop')
    searchMutation.reset()
  }

  /**
   * The proposed plate-first investigation. Runs the staged pipeline so
   * the operator watches the search progress, then hands a route to the
   * SAME results page the real search uses.
   */
  const runInvestigation = async () => {
    setStep('searching')

    const plateProvided = plate.trim().length > 0
    // A plate "reads" only if it looks like a plausible Indian plate.
    // Anything shorter exercises the image fallback, which is a real part
    // of the proposal rather than an error state.
    const plateRecognised = plateProvided && normalisePlate(plate).length >= 8

    await staged.run(buildStages(plateProvided, plateRecognised))

    const startCamera = lastSeenCamera || DEMO_CAMERAS[0].name
    const hops = buildCorridorRoute(startCamera, plateRecognised)
    const result = buildRouteResponse(hops, 'car')

    const watchlistHit = plateRecognised ? findWatchlistHit(plate) : undefined
    if (watchlistHit) {
      // Fired from the click that started the search, so the browser
      // permits playback.
      playAlertSound()
    }

    navigate('/vehicle-search/results', {
      state: {
        result,
        photoPreviewUrl: previewUrl,
        searchedAt: Date.now(),
        // Tells the results page to label this as a simulation.
        simulated: {
          plate: plateProvided ? plate.trim().toUpperCase() : null,
          plateRecognised,
          startCamera,
          watchlistHit: watchlistHit ?? null,
          gapHops: hops.filter((h) => h.foundWithinKm > SEARCH_RADIUS_KM).length,
        },
      },
    })
  }

  const runSearch = async (photoToSend: File) => {
    if (useInvestigation) {
      await runInvestigation()
      return
    }
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

        {/* Plate + last-seen camera. Optional: leaving both blank keeps
            the original photo-only search exactly as it was. */}
        <div className="mt-3 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div className="border-b border-[var(--border-default)] px-[18px] py-3.5">
            <div>
              <p className="text-[13.5px] font-semibold">Narrow the search</p>
              <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                Naming the plate and the camera it was last seen at limits the search to nearby
                cameras, which cuts the error rate sharply.
              </p>
            </div>
          </div>

          <div className="grid gap-4 p-[18px] sm:grid-cols-2">
            <div>
              <label
                htmlFor="vs-plate"
                className="mb-1.5 block text-[12.5px] font-medium text-[var(--text-secondary)]"
              >
                Number plate <span className="font-normal">(optional)</span>
              </label>
              <input
                id="vs-plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="GJ01AB1234"
                disabled={isSearching}
                className="h-11 w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3.5 font-mono text-[13.5px] uppercase outline-none focus:border-[var(--color-brand)] disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="vs-camera"
                className="mb-1.5 block text-[12.5px] font-medium text-[var(--text-secondary)]"
              >
                Last seen at camera <span className="font-normal">(optional)</span>
              </label>
              <select
                id="vs-camera"
                value={lastSeenCamera}
                onChange={(e) => setLastSeenCamera(e.target.value)}
                disabled={isSearching}
                className="h-11 w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 text-[13.5px] outline-none focus:border-[var(--color-brand)] disabled:opacity-60"
              >
                <option value="">Not known</option>
                {DEMO_CAMERAS.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {useInvestigation && (
            <div className="border-t border-[var(--border-default)] px-[18px] py-[15px]">
              <p className={step === 'idle' ? 'mb-3 text-[12px] text-[var(--text-secondary)]' : 'text-[12px] text-[var(--text-secondary)]'}>
                The search expands outward from the last-seen camera in {SEARCH_RADIUS_KM} km steps,
                matching the plate against police records at each camera along the way.
              </p>
              {/* Only shown when there is no photo staged. With a photo,
                  the crop step's own button runs this same flow — two
                  buttons doing the same thing would just be confusing. */}
              {step === 'idle' && (
                <button
                  type="button"
                  onClick={runInvestigation}
                  disabled={isSearching}
                  className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-transparent bg-[var(--color-brand)] text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isSearching && <Loader2 className="h-[15px] w-[15px] animate-spin" />}
                  {isSearching ? 'Tracing route…' : 'Trace route across cameras'}
                </button>
              )}
            </div>
          )}
        </div>

        {staged.stages.length > 0 && (
          <div className="mt-3 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[18px] py-3">
            {staged.stages.map((s, i) => {
              const state = staged.stateFor(i)
              return (
                <div
                  key={s.label}
                  className="flex items-start gap-3 py-2.5 transition-opacity duration-300"
                  style={{ opacity: state === 'pending' ? 0.4 : 1 }}
                >
                  <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    {state === 'done' && (
                      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--color-status-online)]">
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </span>
                    )}
                    {state === 'active' && (
                      <Loader2 className="h-[15px] w-[15px] animate-spin text-[var(--color-brand)]" />
                    )}
                    {state === 'pending' && (
                      <span className="h-2 w-2 rounded-full border border-[var(--border-strong)]" />
                    )}
                  </span>
                  <div className="flex-1">
                    <p className="text-[13px] font-medium">{s.label}</p>
                    <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{s.detail}</p>
                  </div>
                </div>
              )
            })}
          </div>
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
                  {isSearching
                    ? useInvestigation
                      ? 'Tracing route…'
                      : 'Searching sightings…'
                    : useInvestigation
                      ? 'Trace route across cameras'
                      : 'Search past sightings'}
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
