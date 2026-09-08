import { useEffect, useRef } from 'react'
import { AlertTriangle, Bell, Volume2, VolumeX, X } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useAlertFeed, type AlertSeverity, type VehicleAlert } from '@/contexts/AlertFeedContext'

/**
 * Header bell + panel for the 24/7 watchlist feed.
 *
 * NOTE FOR MAINTAINERS: the alerts rendered here are generated in the
 * browser on a timer, not read from the ingest pipeline. See
 * AlertFeedContext for the details.
 */

const SEVERITY: Record<AlertSeverity, { label: string; color: string; bg: string }> = {
  critical: {
    label: 'Critical',
    color: 'var(--color-status-offline)',
    bg: 'var(--color-status-offline-bg)',
  },
  high: {
    label: 'High',
    color: 'var(--color-status-unknown)',
    bg: 'var(--color-status-unknown-bg)',
  },
  medium: {
    label: 'Medium',
    color: 'var(--text-secondary)',
    bg: 'var(--bg-surface-sunken)',
  },
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true })
  } catch {
    return 'just now'
  }
}

export function AlertRow({ alert, compact = false }: { alert: VehicleAlert; compact?: boolean }) {
  const sev = SEVERITY[alert.severity]
  return (
    <div
      className="flex gap-3 px-[15px] py-3"
      style={{ background: alert.read || compact ? 'transparent' : 'var(--bg-surface-raised)' }}
    >
      <span
        className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
        style={{ background: sev.bg, color: sev.color }}
      >
        <AlertTriangle className="h-[13px] w-[13px]" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[13px] font-semibold">{alert.plate}</span>
          <span
            className="rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: sev.bg, color: sev.color }}
          >
            {sev.label}
          </span>
        </div>
        <p className="mt-0.5 text-[12.5px]" style={{ textWrap: 'pretty' }}>
          {alert.reason}
        </p>
        <p className="mt-1 text-[11.5px] text-[var(--text-secondary)]">
          Seen at <span className="font-medium text-[var(--text-primary)]">{alert.cameraName}</span> ·{' '}
          {timeAgo(alert.detectedAt)}
        </p>
        <p className="mt-px font-mono text-[11px] text-[var(--text-secondary)]">
          {alert.caseRef} · plate {Math.round(alert.confidence * 100)}%
        </p>
      </div>
    </div>
  )
}

export function AlertBell() {
  const {
    alerts,
    unreadCount,
    markAllRead,
    clearAll,
    soundEnabled,
    setSoundEnabled,
    panelOpen: open,
    setPanelOpen: setOpen,
  } = useAlertFeed()
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click and on Escape, matching the other header menus.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && unreadCount > 0) markAllRead()
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        title="Watchlist alerts"
        aria-label={`Watchlist alerts${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      >
        <Bell className="h-[15px] w-[15px]" strokeWidth={1.9} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: 'var(--color-status-offline)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[38px] z-[2000] w-[380px] overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-float)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-[15px] py-3">
            <div className="flex-1">
              <p className="text-[13.5px] font-semibold">Watchlist alerts</p>
              <p className="mt-px text-[11.5px] text-[var(--text-secondary)]">
                Raised automatically as cameras are processed
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Mute alert sound' : 'Unmute alert sound'}
              aria-label={soundEnabled ? 'Mute alert sound' : 'Unmute alert sound'}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)]"
            >
              {soundEnabled ? (
                <Volume2 className="h-[15px] w-[15px]" strokeWidth={1.9} />
              ) : (
                <VolumeX className="h-[15px] w-[15px]" strokeWidth={1.9} />
              )}
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-[15px] py-10 text-center">
                <Bell
                  className="mx-auto mb-2 h-5 w-5 text-[var(--text-secondary)]"
                  strokeWidth={1.5}
                />
                <p className="text-[13px] font-medium">No alerts yet</p>
                <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                  Watchlist hits appear here as cameras are processed.
                </p>
              </div>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="border-b border-[var(--border-default)] last:border-b-0">
                  <AlertRow alert={a} />
                </div>
              ))
            )}
          </div>

          {alerts.length > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--border-default)] px-[15px] py-2.5">
              <span className="text-[11.5px] text-[var(--text-secondary)]">
                {alerts.length} alert{alerts.length === 1 ? '' : 's'} this session
              </span>
              <button
                type="button"
                onClick={clearAll}
                className="text-[12px] font-medium text-[var(--color-brand)] underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Corner toast for the newest alert. Sits above page content so an alert
 * is noticed wherever the operator happens to be.
 */
export function AlertToast() {
  const { toast, dismissToast, panelOpen } = useAlertFeed()
  if (!toast) return null

  const sev = SEVERITY[toast.severity]

  return (
    <>
      {/* Kept OUTSIDE the role="alert" element: anything inside it is
          read out by screen readers, and inline CSS text would be
          announced along with the alert. */}
      <style>{`
        @keyframes sentinel-toast-in {
          from { opacity: 0; transform: translateY(10px) scale(.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        role="alert"
        className="fixed bottom-5 z-[3000] w-[360px] overflow-hidden rounded-[10px] border bg-[var(--bg-surface)] shadow-[var(--shadow-float)] transition-[right] duration-200"
        style={{
          // Slide clear of the alerts panel (380px wide, 20px inset) so
          // the toast never covers its "Clear all" footer.
          right: panelOpen ? 416 : 20,
          borderColor: sev.color,
          animation: 'sentinel-toast-in 260ms ease-out',
        }}
      >
      <div
        className="flex items-center gap-2 px-[15px] py-2"
        style={{ background: sev.bg, color: sev.color }}
      >
        <AlertTriangle className="h-[14px] w-[14px]" strokeWidth={2.2} />
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide">
          Watchlist hit · {sev.label}
        </span>
        <button
          type="button"
          onClick={dismissToast}
          aria-label="Dismiss alert"
          className="rounded p-0.5 opacity-70 hover:opacity-100"
        >
          <X className="h-[14px] w-[14px]" />
        </button>
      </div>
        <AlertRow alert={toast} compact />
      </div>
    </>
  )
}
