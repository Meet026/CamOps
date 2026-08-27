import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Crosshair, ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useCamera, useCreateCamera, useUpdateCamera } from '@/hooks/useCameras'
import { uploadCameraPhoto } from '@/api/cameras'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { LocationPickerMap } from '@/components/shared/LocationPickerMap'
import { IntegrationScorePill } from '@/components/ui/StatusPill'
import { SkeletonStack } from '@/components/ui/Skeleton'
import { useDepartments } from '@/hooks/useDepartments'
import { getApiErrorMessage } from '@/api/client'
import * as scoringApi from '@/api/scoring'
import type { CameraType, ScoringResult } from '@/types/api'

interface CameraFormPageProps {
  mode: 'create' | 'edit'
}

export function CameraFormPage({ mode }: CameraFormPageProps) {
  const navigate = useNavigate()
  const { cameraId } = useParams<{ cameraId: string }>()
  const existingCamera = useCamera(mode === 'edit' ? cameraId : undefined)
  const createMutation = useCreateCamera()
  const updateMutation = useUpdateCamera(cameraId ?? '')
  const { data: departments = [] } = useDepartments()

  usePageTitle(mode === 'create' ? 'Add Camera' : 'Edit Camera')

  const [name, setName] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [cameraType, setCameraType] = useState<CameraType>('ip')
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [addressText, setAddressText] = useState('')
  const [isLocatingGps, setIsLocatingGps] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)

  const [hardwareOpen, setHardwareOpen] = useState(false)
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [installedAt, setInstalledAt] = useState('')

  // Network Configuration is edit-only (BACKEND_GAPS.md #4) — these fields
  // power health-monitoring's automated TCP check but aren't meaningful to
  // set before a camera exists, so they never appear in create mode.
  const [networkOpen, setNetworkOpen] = useState(false)
  const [ipAddress, setIpAddress] = useState('')
  const [rtspPort, setRtspPort] = useState('')
  const [streamPath, setStreamPath] = useState('')

  const [photoOpen, setPhotoOpen] = useState(false)
  const [stagedPhoto, setStagedPhoto] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)

  const [submitError, setSubmitError] = useState<string | null>(null)

  // Pre-fill on edit once the real camera loads
  useEffect(() => {
    if (mode === 'edit' && existingCamera.data) {
      const c = existingCamera.data
      setName(c.name)
      setDepartmentId(c.departmentId)
      setCameraType(c.cameraType)
      setLatitude(c.latitude)
      setLongitude(c.longitude)
      setAddressText(c.addressText ?? '')
      setBrand(c.brand ?? '')
      setModel(c.model ?? '')
      setInstalledAt(c.installedAt ?? '')
      setIpAddress(c.ipAddress ?? '')
      setRtspPort(c.rtspPort !== null ? String(c.rtspPort) : '')
      setStreamPath(c.streamPath ?? '')
      if (c.brand || c.model) setHardwareOpen(true)
      if (c.ipAddress || c.rtspPort || c.streamPath) setNetworkOpen(true)
      if (c.photoUrl) setPhotoPreviewUrl(c.photoUrl)
    }
  }, [mode, existingCamera.data])

  // Live scoring preview — fires POST /scoring/lookup once brand+model are
  // both present (PRD 5.3, Section 3). Only runs once the camera actually
  // exists (has a real cameraId), since the endpoint requires one.
  const debouncedBrand = useDebouncedValue(brand, 500)
  const debouncedModel = useDebouncedValue(model, 500)
  const scoringPreviewCameraId = mode === 'edit' ? cameraId : undefined

  const scoringPreview = useQuery<ScoringResult>({
    queryKey: ['scoring-preview', scoringPreviewCameraId, debouncedBrand, debouncedModel],
    queryFn: () => scoringApi.lookupScoring(scoringPreviewCameraId as string, debouncedBrand, debouncedModel),
    enabled: Boolean(scoringPreviewCameraId && debouncedBrand.trim() && debouncedModel.trim()),
  })

  // Brand autocomplete (BACKEND_GAPS.md #9) — suggestion, not restriction:
  // the datalist just surfaces known brands, typing anything else still works.
  const { data: knownBrands = [] } = useQuery({
    queryKey: ['scoring', 'brands'],
    queryFn: () => scoringApi.listKnownBrands(),
    staleTime: 5 * 60 * 1000,
  })

  const handleUseCurrentLocation = () => {
    setGpsError(null)
    if (!navigator.geolocation) {
      setGpsError('GPS is not available on this device.')
      return
    }
    setIsLocatingGps(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude)
        setLongitude(position.coords.longitude)
        setIsLocatingGps(false)
      },
      () => {
        setGpsError('GPS unavailable? Set the location manually on the map above.')
        setIsLocatingGps(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handlePhotoSelect = (file: File) => {
    setStagedPhoto(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
  }

  const isDirty =
    mode === 'create' ||
    (existingCamera.data &&
      (name !== existingCamera.data.name ||
        latitude !== existingCamera.data.latitude ||
        longitude !== existingCamera.data.longitude ||
        cameraType !== existingCamera.data.cameraType ||
        brand !== (existingCamera.data.brand ?? '') ||
        model !== (existingCamera.data.model ?? '') ||
        addressText !== (existingCamera.data.addressText ?? '') ||
        installedAt !== (existingCamera.data.installedAt ?? '') ||
        ipAddress !== (existingCamera.data.ipAddress ?? '') ||
        rtspPort !== (existingCamera.data.rtspPort !== null ? String(existingCamera.data.rtspPort) : '') ||
        streamPath !== (existingCamera.data.streamPath ?? '') ||
        stagedPhoto !== null))

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitError(null)

    if (latitude === null || longitude === null) {
      setSubmitError('Set a location on the map before saving.')
      return
    }

    const sharedFields = {
      name,
      latitude,
      longitude,
      cameraType,
      brand: brand || undefined,
      model: model || undefined,
      addressText: addressText || undefined,
      installedAt: installedAt || undefined,
    }

    try {
      let saved
      if (mode === 'create') {
        saved = await createMutation.mutateAsync({ ...sharedFields, departmentId })
      } else {
        // departmentId is create-only — UpdateCameraDto rejects it outright
        // (a camera's department can't be reassigned via this endpoint), so
        // it must never appear in the edit-mode payload.
        saved = await updateMutation.mutateAsync({
          ...sharedFields,
          ipAddress: ipAddress || undefined,
          rtspPort: rtspPort ? Number(rtspPort) : undefined,
          streamPath: streamPath || undefined,
        })
      }

      if (stagedPhoto) {
        await uploadCameraPhoto(saved.cameraId, stagedPhoto)
      }

      navigate(`/cameras/${saved.cameraId}`)
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, 'Could not save this camera.'))
    }
  }

  if (mode === 'edit' && existingCamera.isLoading) {
    return (
      <div className="mx-auto max-w-[640px] p-6">
        <SkeletonStack count={5} rowClassName="h-9" />
      </div>
    )
  }

  return (
    <div className="p-6 pb-20">
      <div className="mx-auto max-w-[640px]">
        <div className="mb-6">
          <p className="text-[22px] font-semibold tracking-tight">{mode === 'create' ? 'Add camera' : 'Edit camera'}</p>
          <p className="text-[13px] text-[var(--text-secondary)]">
            {mode === 'create' ? 'Four fields is enough to register. Everything else is optional.' : 'Update any field — changes save when you submit.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Identity */}
          <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
            <h2 className="mb-4 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Identity</h2>
            <div className="mb-4">
              <label className="mb-1.5 block text-[12.5px] font-medium">
                Name <span className="text-[var(--color-status-offline)]">*</span>
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ring Road Junction Cam-04" required />
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12.5px] font-medium">
                  Department <span className="text-[var(--color-status-offline)]">*</span>
                </label>
                <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
                  <option value="" disabled>
                    Select department
                  </option>
                  {departments.map((d) => (
                    <option key={d.departmentId} value={d.departmentId}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[12.5px] font-medium">
                  Camera type <span className="text-[var(--color-status-offline)]">*</span>
                </label>
                <SegmentedControl
                  options={[
                    { value: 'ip', label: 'IP' },
                    { value: 'analog', label: 'Analog' },
                  ]}
                  value={cameraType}
                  onChange={setCameraType}
                />
              </div>
            </div>
          </section>

          {/* Location */}
          <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Location</h2>
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={isLocatingGps}
                className="flex items-center gap-[7px] rounded-lg border border-[var(--color-brand-border)] bg-[var(--color-brand-soft)] px-[11px] py-1.5 text-[12.5px] font-semibold text-[var(--color-brand)] disabled:opacity-60">
                <Crosshair className="h-3.5 w-3.5" /> {isLocatingGps ? 'Locating…' : 'Use my current location'}
              </button>
            </div>
            <LocationPickerMap
              latitude={latitude}
              longitude={longitude}
              onChange={(lat, lng) => {
                setLatitude(lat)
                setLongitude(lng)
              }}
              className="mb-3.5 h-[220px]"
            />
            {gpsError && <p className="mb-3 text-xs text-[var(--text-secondary)]">{gpsError}</p>}
            <div className="mb-3.5 grid grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1.5 block text-[12.5px] font-medium">Latitude</label>
                <Input
                  type="number"
                  step="any"
                  value={latitude ?? ''}
                  onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
                  className="font-mono"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12.5px] font-medium">Longitude</label>
                <Input
                  type="number"
                  step="any"
                  value={longitude ?? ''}
                  onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
                  className="font-mono"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-medium">Address / landmark notes</label>
              <Input value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="Optional" />
            </div>
            <p className="mt-2.5 text-xs text-[var(--text-secondary)]">
              Descriptive only — not used for positioning. Tap the map or drag the pin to set coordinates.
            </p>
          </section>

          {/* Hardware Details (collapsible) */}
          <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <button
              type="button"
              onClick={() => setHardwareOpen((o) => !o)}
              className="flex w-full items-center gap-2.5 px-5 py-4"
            >
              <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-150 ${hardwareOpen ? 'rotate-180' : ''}`} />
              <div className="flex-1 text-left">
                <p className="text-[13.5px] font-medium">Hardware details</p>
                <p className="text-[12.5px] text-[var(--text-secondary)]">Brand and model unlock an instant integration score</p>
              </div>
              <span className="text-xs text-[var(--text-secondary)]">Optional</span>
            </button>
            {hardwareOpen && (
              <div className="space-y-3.5 px-5 pb-5">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-medium">Brand</label>
                    <Input value={brand} onChange={(e) => setBrand(e.target.value)} list="brand-options" placeholder="Hikvision" />
                    <datalist id="brand-options">
                      {knownBrands.map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-medium">Model</label>
                    <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="DS-2CD2143G2" />
                  </div>
                </div>

                {scoringPreview.isFetching && (
                  <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking vendor database…
                  </div>
                )}
                {scoringPreview.data && !scoringPreview.isFetching && (
                  <div className="flex items-center gap-3 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-4 py-3.5">
                    <IntegrationScorePill score={scoringPreview.data.integrationScore} />
                    <span className="flex-1 text-[12.5px] text-[var(--text-secondary)]">
                      {scoringPreview.data.onvifSource === 'lookup_table'
                        ? 'Integration score resolved from the vendor lookup — no review needed.'
                        : scoringPreview.data.onvifSource === 'ai_guess'
                          ? 'AI-suggested — pending admin review.'
                          : ''}
                    </span>
                  </div>
                )}
                {mode === 'create' && brand && model && (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Live scoring preview appears here once the camera is created.
                  </p>
                )}

                <div>
                  <label className="mb-1.5 block text-[12.5px] font-medium">Installed date</label>
                  <Input type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} />
                </div>
              </div>
            )}
          </section>

          {/* Network Configuration (collapsible, edit mode only) */}
          {mode === 'edit' && (
            <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
              <button
                type="button"
                onClick={() => setNetworkOpen((o) => !o)}
                className="flex w-full items-center gap-2.5 px-5 py-4"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-150 ${networkOpen ? 'rotate-180' : ''}`} />
                <div className="flex-1 text-left">
                  <p className="text-[13.5px] font-medium">Network configuration</p>
                  <p className="text-[12.5px] text-[var(--text-secondary)]">Lets the Health tab reach this camera with a real TCP check</p>
                </div>
                <span className="text-xs text-[var(--text-secondary)]">Optional</span>
              </button>
              {networkOpen && (
                <div className="space-y-3.5 px-5 pb-5">
                  <div>
                    <label className="mb-1.5 block text-[12.5px] font-medium">IP address</label>
                    <Input
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      placeholder="e.g. 192.168.1.50"
                      className="font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="mb-1.5 block text-[12.5px] font-medium">RTSP port</label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={rtspPort}
                        onChange={(e) => setRtspPort(e.target.value)}
                        placeholder="554"
                        className="font-mono"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12.5px] font-medium">Stream path</label>
                      <Input
                        value={streamPath}
                        onChange={(e) => setStreamPath(e.target.value)}
                        placeholder="/stream1"
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Photo (collapsible) */}
          <section className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <button
              type="button"
              onClick={() => setPhotoOpen((o) => !o)}
              className="flex w-full items-center gap-2.5 px-5 py-4"
            >
              <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform duration-150 ${photoOpen ? 'rotate-180' : ''}`} />
              <p className="flex-1 text-left text-[13.5px] font-medium">Photo</p>
              <span className="text-xs text-[var(--text-secondary)]">Optional</span>
            </button>
            {photoOpen && (
              <div className="space-y-3 px-5 pb-5">
                <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border-strong)] text-center text-[var(--text-secondary)]">
                  {photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Camera preview" className="h-full w-full rounded-[10px] object-cover" />
                  ) : (
                    <>
                      <ImagePlus className="h-[22px] w-[22px]" strokeWidth={1.6} />
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">Drop a photo, or tap to browse</span>
                      <span className="text-xs">We'll run "Identify from photo" to suggest brand and model.</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handlePhotoSelect(e.target.files[0])}
                  />
                </label>

                {mode === 'edit' && existingCamera.data?.photoUrl && (
                  <OcrIdentifyButton
                    cameraId={cameraId as string}
                    onIdentified={(b, m) => {
                      setBrand(b)
                      setModel(m)
                      setHardwareOpen(true)
                    }}
                  />
                )}
              </div>
            )}
          </section>

          {submitError && <p className="text-sm text-[var(--color-status-offline)]">{submitError}</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" isLoading={isSubmitting} disabled={!isDirty}>
              {mode === 'create' ? 'Add camera' : 'Save changes'}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OcrIdentifyButton({
  cameraId,
  onIdentified,
}: {
  cameraId: string
  onIdentified: (brand: string, model: string) => void
}) {
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<{ identified: boolean; brand?: string; model?: string } | null>(null)

  const run = async () => {
    setIsRunning(true)
    try {
      const res = await scoringApi.lookupScoringByPhoto(cameraId)
      setResult(res)
      if (res.identified && res.brand && res.model) {
        onIdentified(res.brand, res.model)
      }
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={run} isLoading={isRunning}>
        <Sparkles className="h-3.5 w-3.5" /> Identify from photo
      </Button>
      {result && (
        <p className="text-xs text-[var(--text-secondary)]">
          {result.identified
            ? `AI-suggested — please verify: ${result.brand} ${result.model}`
            : "Couldn't identify a brand/model from this photo."}
        </p>
      )}
    </div>
  )
}
