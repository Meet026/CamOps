import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Loader2, ShieldAlert } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useVehicleRouteSearch } from '@/hooks/useVehicleSearch'
import { getVehicleApiErrorMessage, getVehicleApiErrorStatus } from '@/api/vehicleClient'
import { getApiErrorMessage } from '@/api/client'
import * as wantedListApi from '@/api/wantedList'
import { WantedMatchToast } from '@/components/shared/WantedMatchToast'
import { playWantedMatchAlert } from '@/lib/alert-sound'
import { CropOverlay, DEFAULT_CROP_RECT, cropImageToFile, type CropRect } from './CropOverlay'
import type { VehicleRouteResponse } from '@/types/vehicleApi'
import type { CheckPlateResult } from '@/types/api'

// Pixel-matched to the reference (Sentinel.dc.html) Vehicle Search screen:
// dashed drop zone -> crop step (draggable frame, corner handles,
// rule-of-thirds grid) -> search, with the design's exact copy, the
// "Skip cropping" text link, and its 422/503 error banner treatment.
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

  usePageTitle('Vehicle Search')

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
