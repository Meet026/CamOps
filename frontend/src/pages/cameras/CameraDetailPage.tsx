import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { Camera as CameraIcon, RefreshCw } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAuth } from '@/contexts/AuthContext'
import { useCamera, useDeactivateCamera } from '@/hooks/useCameras'
import { useCheckNow, useHealthCurrent, useHealthHistory } from '@/hooks/useHealth'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LocationPickerMap } from '@/components/shared/LocationPickerMap'
import { useDepartments } from '@/hooks/useDepartments'
import type { CameraRecord, HealthHistoryEntry } from '@/types/api'

type Tab = 'overview' | 'health' | 'location'

const STATUS_STYLE: Record<CameraRecord['currentStatus'], { label: string; color: string; bg: string }> = {
  online: { label: 'Online', color: 'var(--color-status-online)', bg: 'var(--color-status-online-bg)' },
  offline: { label: 'Offline', color: 'var(--color-status-offline)', bg: 'var(--color-status-offline-bg)' },
  unknown: { label: 'Unknown', color: 'var(--color-status-unknown)', bg: 'var(--color-status-unknown-bg)' },
}

const SCORE_STYLE: Record<CameraRecord['integrationScore'], { label: string; fg: string; bg: string; dashed?: boolean }> = {
  easy: { label: 'Easy', fg: 'var(--color-status-online)', bg: 'var(--color-status-online-bg)' },
  medium: { label: 'Medium', fg: 'var(--color-status-unknown)', bg: 'var(--color-status-unknown-bg)' },
  hard: { label: 'Hard', fg: 'var(--color-status-offline)', bg: 'var(--color-status-offline-bg)' },
  needs_verification: { label: 'Needs verification', fg: 'var(--color-status-neutral)', bg: 'transparent', dashed: true },
}

// Pixel-matched to the reference (Sentinel.dc.html) camera detail screen:
// 1fr/320px two-column layout, tabbed left card (Overview/Health/Location),
// right sidebar with "At a glance" pills + an actions card + a real recent-
// events timeline sourced from health-check history (not a generic activity
// log the backend doesn't have).
export function CameraDetailPage() {
  const { cameraId } = useParams<{ cameraId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(initialTab === 'health' || initialTab === 'location' ? initialTab : 'overview')
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const cameraQuery = useCamera(cameraId)
  const deactivateMutation = useDeactivateCamera()
  const { data: departments = [] } = useDepartments()

  usePageTitle(cameraQuery.data ? cameraQuery.data.name : 'Camera')

  if (cameraQuery.isLoading) {
    return <div className="p-6 text-sm text-[var(--text-secondary)]">Loading…</div>
  }

  if (cameraQuery.isError || !cameraQuery.data) {
    // Real backend returns 404 (never 403) even for a dept_viewer hitting
    // another department's camera — deliberately never distinguishing
    // "doesn't exist" from "you can't see it" (PRD 5.5).
    return (
      <div className="p-6">
        <EmptyState icon={CameraIcon} title="Camera not found" />
      </div>
    )
  }

  const camera = cameraQuery.data
  const department = departments.find((d) => d.departmentId === camera.departmentId)
  const canEdit = user?.role === 'admin' || user?.role === 'field_officer'
  const canDeactivate = user?.role === 'admin'
  const status = STATUS_STYLE[camera.currentStatus]
  const score = SCORE_STYLE[camera.integrationScore]

  const handleDeactivate = async () => {
    await deactivateMutation.mutateAsync(camera.cameraId)
    setConfirmDeactivate(false)
    navigate('/cameras')
  }

  return (
    <div className="p-6">
      {!camera.isActive && (
        <div className="mb-4 rounded-[10px] bg-[var(--color-status-neutral-bg)] px-4 py-2.5 text-sm text-[var(--color-status-neutral)]">
          This camera is inactive.
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div className="flex gap-0.5 border-b border-[var(--border-default)] px-2.5 py-1.5">
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
            <TabButton active={tab === 'health'} onClick={() => setTab('health')}>Health</TabButton>
            <TabButton active={tab === 'location'} onClick={() => setTab('location')}>Location</TabButton>
          </div>

          {tab === 'overview' && (
            <OverviewTab camera={camera} department={department?.name ?? ''} score={score} onEdit={() => navigate(`/cameras/${camera.cameraId}/edit`)} />
          )}
          {tab === 'health' && <HealthTab cameraId={camera.cameraId} cameraType={camera.cameraType} />}
          {tab === 'location' && (
            <div>
              <LocationPickerMap latitude={camera.latitude} longitude={camera.longitude} onChange={() => {}} readOnly className="h-[420px] rounded-none border-0" />
              <div className="flex flex-wrap items-center gap-5 border-t border-[var(--border-default)] px-5 py-3.5">
                <div>
                  <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Latitude</p>
                  <p className="font-mono text-[13px]">{camera.latitude}</p>
                </div>
                <div>
                  <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Longitude</p>
                  <p className="font-mono text-[13px]">{camera.longitude}</p>
                </div>
                <div className="flex-1">
                  <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Address / landmark</p>
                  <p className="text-[13px]">{camera.addressText ?? '—'}</p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => navigate(`/cameras/${camera.cameraId}/edit`)}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 hover:border-[var(--border-strong)]">
                    Edit location
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">At a glance</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full px-[11px] py-1 text-xs font-medium" style={{ color: status.color, background: status.bg }}>
                {status.label}
              </span>
              <span
                className="rounded-full px-[11px] py-1 text-xs font-medium"
                style={{
                  color: score.fg,
                  background: score.bg,
                  border: score.dashed ? '1px dashed var(--color-status-ai)' : '1px solid transparent',
                }}>
                {score.label}
              </span>
              <span className="rounded-full bg-[var(--bg-surface-sunken)] px-[11px] py-1 text-xs text-[var(--text-secondary)]">
                {department?.name ?? '—'}
              </span>
            </div>
          </div>

          {(canEdit || canDeactivate) && (
            <div className="flex flex-col gap-1 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5">
              {canEdit && (
                <button
                  onClick={() => navigate(`/cameras/${camera.cameraId}/edit`)}
                  className="rounded-lg bg-[var(--color-brand)] px-3 py-2.5 text-center text-[13px] font-semibold text-white transition-[filter] duration-150 hover:brightness-110">
                  Edit camera
                </button>
              )}
              {canDeactivate && camera.isActive && (
                <Button variant="destructive" size="sm" onClick={() => setConfirmDeactivate(true)} className="w-full">
                  Deactivate
                </Button>
              )}
            </div>
          )}

          <RecentEventsCard camera={camera} />
        </aside>
      </div>

      <ConfirmDialog
        isOpen={confirmDeactivate}
        title="Deactivate this camera?"
        description="This is non-destructive — the camera's history is preserved, and it can be reactivated later via Edit."
        confirmLabel="Deactivate"
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmDeactivate(false)}
        isConfirming={deactivateMutation.isPending}
      />
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
        active ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}>
      {children}
    </button>
  )
}

function OverviewTab({
  camera,
  department,
  score,
  onEdit,
}: {
  camera: CameraRecord
  department: string
  score: { label: string; fg: string; bg: string; dashed?: boolean }
  onEdit: () => void
}) {
  const facts = [
    { k: 'Camera id', v: camera.cameraId.slice(0, 13), mono: true },
    { k: 'Department', v: department || '—' },
    { k: 'Type', v: camera.cameraType.toUpperCase() },
    { k: 'Brand', v: camera.brand || '—' },
    { k: 'Model', v: camera.model || '—', mono: true },
    { k: 'Installed', v: camera.installedAt ? format(new Date(camera.installedAt), 'PP') : '—' },
    { k: 'Coordinates', v: `${camera.latitude}, ${camera.longitude}`, mono: true },
    { k: 'Created', v: format(new Date(camera.createdAt), 'yyyy-MM-dd HH:mm'), mono: true },
    { k: 'Updated', v: format(new Date(camera.updatedAt), 'yyyy-MM-dd HH:mm'), mono: true },
  ]

  return (
    <div className="p-5">
      <div className="mb-6 flex gap-5">
        <div className="flex h-[132px] w-[200px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-sunken)] text-[var(--text-secondary)]">
          {camera.photoUrl ? (
            <img src={camera.photoUrl} alt={camera.name} className="h-full w-full rounded-[10px] object-cover" />
          ) : (
            <>
              <CameraIcon className="h-[22px] w-[22px]" strokeWidth={1.6} />
              <span className="text-[11.5px]">Camera photo</span>
            </>
          )}
        </div>
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[12.5px] font-medium"
              style={{
                color: score.fg,
                background: score.bg,
                border: score.dashed ? '1px dashed var(--color-status-ai)' : '1px solid transparent',
              }}>
              Integration: {score.label}
            </span>
            <span className="rounded-full bg-[var(--bg-surface-sunken)] px-[11px] py-1 text-[12.5px] text-[var(--text-secondary)]">
              ONVIF: {camera.onvifStatus === 'unknown' ? 'Unknown' : camera.onvifStatus}
            </span>
            <button
              onClick={onEdit}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-[11px] py-[5px] text-[12.5px] font-medium transition-colors duration-150 hover:border-[var(--border-strong)]">
              Edit hardware
            </button>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">
            {camera.onvifSource === 'lookup_table'
              ? 'Matched in the vendor lookup table — future cameras of this model resolve instantly.'
              : camera.onvifSource === 'ai_guess'
                ? 'AI-suggested from brand/model — pending admin verification.'
                : camera.onvifSource === 'user_confirmed'
                  ? 'Confirmed by an admin during scoring verification.'
                  : 'No brand/model set yet — add hardware details via Edit to resolve an integration score.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--border-default)] sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.k} className="bg-[var(--bg-surface)] px-4 py-3.5">
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{f.k}</p>
            <p className={f.mono ? 'font-mono text-[13.5px]' : 'text-[13.5px]'}>{f.v}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function HealthTab({ cameraId, cameraType }: { cameraId: string; cameraType: 'ip' | 'analog' }) {
  const currentQuery = useHealthCurrent(cameraId)
  const historyQuery = useHealthHistory(cameraId)
  const checkNowMutation = useCheckNow(cameraId)
  const [manualPromptOpen, setManualPromptOpen] = useState(false)

  const needsManualStatus = cameraType === 'analog' || !currentQuery.data?.ipAddress

  const handleCheckNow = () => {
    if (needsManualStatus) {
      setManualPromptOpen(true)
      return
    }
    checkNowMutation.mutate(undefined)
  }

  const handleManualReport = (status: 'online' | 'offline') => {
    checkNowMutation.mutate(status)
    setManualPromptOpen(false)
  }

  const status = currentQuery.data ? STATUS_STYLE[currentQuery.data.currentStatus] : null
  const offlineCount = historyQuery.data?.filter((h) => h.status === 'offline').length ?? 0
  const onlineRatio =
    historyQuery.data && historyQuery.data.length > 0
      ? Math.round((historyQuery.data.filter((h) => h.status === 'online').length / historyQuery.data.length) * 1000) / 10
      : null

  return (
    <div className="p-5">
      <div className="mb-5 flex items-center gap-4 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-4">
        {status && (
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: status.color, boxShadow: `0 0 0 5px ${status.bg}` }}
          />
        )}
        <div className="flex-1">
          <p className="text-xl font-semibold tracking-tight">{status?.label ?? 'Unknown'}</p>
          {currentQuery.data?.ipAddress && (
            <p className="font-mono text-[12.5px] text-[var(--text-secondary)]">
              {currentQuery.data.ipAddress}
              {currentQuery.data.rtspPort ? `:${currentQuery.data.rtspPort}` : ''}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={handleCheckNow} isLoading={checkNowMutation.isPending}>
          <RefreshCw className="h-3.5 w-3.5" /> Check now
        </Button>
      </div>

      {manualPromptOpen && (
        <div className="mb-5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <p className="mb-3 text-sm">Report current status:</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleManualReport('online')}>
              Online
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleManualReport('offline')}>
              Offline
            </Button>
          </div>
        </div>
      )}

      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="text-base font-semibold">Uptime · recent checks</p>
        {onlineRatio !== null && (
          <p className="font-mono text-[12.5px] text-[var(--text-secondary)]">
            {onlineRatio}% uptime · {offlineCount} offline event{offlineCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
      {historyQuery.data && historyQuery.data.length > 0 ? (
        <div className="flex h-14 gap-0.5">
          {[...historyQuery.data].reverse().map((entry) => (
            <div
              key={entry.id}
              title={`${entry.status} — ${format(new Date(entry.checkedAt), 'PPp')}`}
              className="flex-1 rounded-[3px] opacity-90"
              style={{
                backgroundColor: entry.status === 'online' ? 'var(--color-status-online)' : 'var(--color-status-offline)',
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">No history recorded yet.</p>
      )}
    </div>
  )
}

function RecentEventsCard({ camera }: { camera: CameraRecord }) {
  const historyQuery = useHealthHistory(camera.cameraId)

  const events = buildRecentEvents(camera, historyQuery.data)

  return (
    <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      <p className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Recent events</p>
      {events.length === 0 ? (
        <p className="py-2 text-xs text-[var(--text-secondary)]">No events recorded yet.</p>
      ) : (
        events.map((event, i) => (
          <div key={i} className="flex gap-2.5 py-1.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: event.color }} />
            <div className="flex-1 text-[12.5px]">
              {event.text}
              <p className="font-mono text-[11.5px] text-[var(--text-secondary)]">{event.time}</p>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// Real events, not mock data — built from health-check status transitions
// (the only per-camera timeline the backend actually records) plus
// registration. A transition-detection pass over the raw history, since the
// API returns individual checks, not pre-computed "went offline" events.
function buildRecentEvents(camera: CameraRecord, history: HealthHistoryEntry[] | undefined) {
  const events: { color: string; text: string; time: string; sortKey: number }[] = []

  if (history && history.length > 0) {
    const chronological = [...history].reverse()
    let prevStatus: string | null = null
    for (const entry of chronological) {
      if (prevStatus !== null && entry.status !== prevStatus) {
        events.push({
          color: entry.status === 'offline' ? 'var(--color-status-offline)' : 'var(--color-status-online)',
          text: entry.status === 'offline' ? 'Went offline' : 'Came back online',
          time: format(new Date(entry.checkedAt), 'yyyy-MM-dd HH:mm'),
          sortKey: new Date(entry.checkedAt).getTime(),
        })
      }
      prevStatus = entry.status
    }
  }

  events.push({
    color: 'var(--color-brand)',
    text: 'Registered',
    time: format(new Date(camera.createdAt), 'yyyy-MM-dd HH:mm'),
    sortKey: new Date(camera.createdAt).getTime(),
  })

  return events.sort((a, b) => b.sortKey - a.sortKey).slice(0, 4)
}
