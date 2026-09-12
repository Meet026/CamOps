import { useEffect } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import type { WantedVehicle } from '@/types/api'

const AUTO_DISMISS_MS = 8000

// A transient, corner-anchored alert — distinct from the inline result
// banner on the page itself — so a wanted-list match reads as an actual
// notification event (the same moment the backend records one in
// wanted_list_notification), not just a quiet line of result text you
// could miss if you looked away from the form.
export function WantedMatchToast({
  wantedVehicle,
  onDismiss,
}: {
  wantedVehicle: WantedVehicle
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      role="alert"
      className="fixed right-6 top-6 z-[100] w-[360px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-[10px] border border-[var(--color-status-offline)] bg-[var(--bg-surface-raised)] shadow-[var(--shadow-float)] animate-in slide-in-from-top-2 fade-in duration-200"
    >
      <div className="flex items-center gap-2 bg-[var(--color-status-offline)] px-4 py-2">
        <ShieldAlert className="h-4 w-4 text-white" />
        <span className="text-[12.5px] font-bold uppercase tracking-wide text-white">
          Wanted list alert
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          className="text-white/80 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-4 py-3">
        <p className="font-mono text-[15px] font-semibold tracking-wide">
          {wantedVehicle.plateNumber}
        </p>
        <p className="mt-1 text-[13px] font-medium">{wantedVehicle.personName}</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{wantedVehicle.crimeDetails}</p>
      </div>
    </div>
  )
}
