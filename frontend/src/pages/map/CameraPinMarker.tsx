import { useNavigate } from 'react-router-dom'
import { CircleMarker, Popup } from 'react-leaflet'
import { useDepartments } from '@/hooks/useDepartments'
import { CurrentStatusPill, IntegrationScorePill } from '@/components/ui/StatusPill'
import type { CameraPin, CurrentStatus, IntegrationScore } from '@/types/api'

const STATUS_COLOR: Record<CurrentStatus, string> = {
  online: '#22c55e',
  offline: '#ef4444',
  unknown: '#f59e0b',
}

const SCORE_COLOR: Record<IntegrationScore, string> = {
  easy: '#22c55e',
  medium: '#f59e0b',
  hard: '#ef4444',
  needs_verification: '#a855f7',
}

interface CameraPinMarkerProps {
  pin: CameraPin
  colorMode: 'status' | 'score'
}

export function CameraPinMarker({ pin, colorMode }: CameraPinMarkerProps) {
  const navigate = useNavigate()
  const { data: departments = [] } = useDepartments()
  const color = colorMode === 'status' ? STATUS_COLOR[pin.currentStatus] : SCORE_COLOR[pin.integrationScore]
  const department = departments.find((d) => d.departmentId === pin.departmentId)

  return (
    <CircleMarker
      center={[pin.latitude, pin.longitude]}
      radius={7}
      pathOptions={{ color: '#0a0b0d', weight: 2, fillColor: color, fillOpacity: 1 }}
    >
      <Popup>
        <div className="min-w-[180px] space-y-1.5 font-sans">
          <p className="text-sm font-semibold">{pin.name}</p>
          <p className="text-xs text-[var(--text-secondary)]">{department?.name}</p>
          <div className="flex flex-wrap gap-1 pt-1">
            <CurrentStatusPill status={pin.currentStatus} />
            <IntegrationScorePill score={pin.integrationScore} />
          </div>
          <button
            onClick={() => navigate(`/cameras/${pin.cameraId}`)}
            className="pt-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            View full detail →
          </button>
        </div>
      </Popup>
    </CircleMarker>
  )
}
