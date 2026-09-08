import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEMO_CAMERAS } from '@/pages/vehicle-search/demoInvestigation'
import { playAlertSound } from '@/pages/vehicle-search/alertSound'

/**
 * DEMO / FUTURE-SCOPE SIMULATION — not a live alert feed.
 *
 * This models what the system is *proposed* to do continuously: the
 * vehicle-ingest service pulls frames from every camera around the
 * clock, and each detected vehicle's plate/fingerprint is matched
 * against the police wanted list. A hit raises an alert without anyone
 * having searched for it.
 *
 * What is REAL here:
 *   - The camera names and coordinates, from this project's own `camera`
 *     table.
 *   - The shape of the event: a vehicle, at a specific camera, at a
 *     specific time, matched against a watchlist entry.
 *
 * What is SIMULATED here:
 *   - Every alert. Nothing is read from the ingest pipeline or the
 *     database; alerts are generated on a timer in the browser.
 *   - The plates, case references and confidence values.
 *
 * There is no ANPR model in this project, so no real plate match exists
 * to feed this yet. Replacing this with a live feed means swapping the
 * timer below for a subscription to the ingest service — the alert shape
 * and the UI stay as they are.
 */

/** How often a new alert arrives. */
export const ALERT_INTERVAL_MS = 60_000

/** The first alert lands sooner so a demo does not open to an empty panel. */
const FIRST_ALERT_DELAY_MS = 8_000

export type AlertSeverity = 'critical' | 'high' | 'medium'

export interface VehicleAlert {
  id: string
  plate: string
  vehicleClass: string
  cameraName: string
  detectedAt: string
  reason: string
  caseRef: string
  raisedBy: string
  severity: AlertSeverity
  /** Plate-read confidence, 0-1. */
  confidence: number
  read: boolean
}

/**
 * The pool of wanted vehicles alerts are drawn from. In a real system
 * this is the police wanted list, queried per detection.
 */
const WANTED_POOL: Omit<VehicleAlert, 'id' | 'cameraName' | 'detectedAt' | 'confidence' | 'read'>[] = [
  {
    plate: 'GJ01AB1234',
    vehicleClass: 'car',
    reason: 'Flagged in an active hit-and-run investigation',
    caseRef: 'FIR 0412/2026',
    raisedBy: 'Ahmedabad City Traffic Division',
    severity: 'critical',
  },
  {
    plate: 'GJ05CD5678',
    vehicleClass: 'car',
    reason: 'Reported stolen',
    caseRef: 'FIR 0388/2026',
    raisedBy: 'Vadodara City Police',
    severity: 'critical',
  },
  {
    plate: 'GJ18EF9012',
    vehicleClass: 'motorcycle',
    reason: 'Linked to a chain-snatching series in the western zone',
    caseRef: 'FIR 0455/2026',
    raisedBy: 'Ahmedabad City Crime Branch',
    severity: 'high',
  },
  {
    plate: 'GJ27GH3456',
    vehicleClass: 'truck',
    reason: 'Carrying goods flagged by the State Excise Department',
    caseRef: 'EXC 1189/2026',
    raisedBy: 'Gujarat State Excise',
    severity: 'high',
  },
  {
    plate: 'GJ06JK7890',
    vehicleClass: 'car',
    reason: 'Owner has an outstanding non-bailable warrant',
    caseRef: 'NBW 0233/2026',
    raisedBy: 'Surat District Court',
    severity: 'medium',
  },
  {
    plate: 'GJ03LM2244',
    vehicleClass: 'car',
    reason: 'Registration cancelled — vehicle should not be in use',
    caseRef: 'RTO 0761/2026',
    raisedBy: 'Regional Transport Office, Ahmedabad',
    severity: 'medium',
  },
  {
    plate: 'GJ12NP8833',
    vehicleClass: 'motorcycle',
    reason: 'Matches a vehicle seen fleeing a burglary in Navrangpura',
    caseRef: 'FIR 0470/2026',
    raisedBy: 'Ahmedabad City Police',
    severity: 'high',
  },
]

function randomAlert(sequence: number): VehicleAlert {
  const wanted = WANTED_POOL[sequence % WANTED_POOL.length]
  const camera = DEMO_CAMERAS[Math.floor(Math.random() * DEMO_CAMERAS.length)]
  // Plate reads from live traffic are good but rarely perfect.
  const confidence = Number((0.88 + Math.random() * 0.11).toFixed(3))

  return {
    ...wanted,
    // Unique across a session even if the same vehicle re-appears.
    id: `alert-${sequence}-${Date.now()}`,
    cameraName: camera.name,
    detectedAt: new Date().toISOString(),
    confidence,
    read: false,
  }
}

interface AlertFeedValue {
  alerts: VehicleAlert[]
  unreadCount: number
  /** The most recent alert, while it is still being shown as a toast. */
  toast: VehicleAlert | null
  dismissToast: () => void
  markAllRead: () => void
  clearAll: () => void
  soundEnabled: boolean
  setSoundEnabled: (on: boolean) => void
  /**
   * Whether the header panel is open. Both it and the toast anchor to the
   * bottom-right, so the toast shifts aside rather than covering the
   * panel's footer controls.
   */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
}

const AlertFeedContext = createContext<AlertFeedValue | null>(null)

/** How long the corner toast stays on screen. */
const TOAST_VISIBLE_MS = 9_000

/** Cap the stored feed so a long-running demo cannot grow unbounded. */
const MAX_ALERTS = 40

export function AlertFeedProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<VehicleAlert[]>([])
  const [toast, setToast] = useState<VehicleAlert | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)

  // Read inside the interval without making it a dependency — changing
  // the sound setting must not restart the alert timer.
  const soundRef = useRef(soundEnabled)
  useEffect(() => {
    soundRef.current = soundEnabled
  }, [soundEnabled])

  const sequenceRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)

  const pushAlert = useCallback(() => {
    const alert = randomAlert(sequenceRef.current++)
    setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS))
    setToast(alert)

    if (soundRef.current) {
      // Browsers block audio until the user has interacted with the
      // page. Before that this is a no-op, by design — the visual alert
      // still lands, and playAlertSound swallows the failure.
      playAlertSound()
    }

    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_VISIBLE_MS)
  }, [])

  useEffect(() => {
    const first = window.setTimeout(pushAlert, FIRST_ALERT_DELAY_MS)
    const interval = window.setInterval(pushAlert, ALERT_INTERVAL_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [pushAlert])

  const value = useMemo<AlertFeedValue>(
    () => ({
      alerts,
      unreadCount: alerts.filter((a) => !a.read).length,
      toast,
      dismissToast: () => setToast(null),
      markAllRead: () => setAlerts((prev) => prev.map((a) => ({ ...a, read: true }))),
      clearAll: () => setAlerts([]),
      soundEnabled,
      setSoundEnabled,
      panelOpen,
      setPanelOpen,
    }),
    [alerts, toast, soundEnabled, panelOpen],
  )

  return <AlertFeedContext.Provider value={value}>{children}</AlertFeedContext.Provider>
}

export function useAlertFeed() {
  const ctx = useContext(AlertFeedContext)
  if (!ctx) throw new Error('useAlertFeed must be used within an AlertFeedProvider')
  return ctx
}
