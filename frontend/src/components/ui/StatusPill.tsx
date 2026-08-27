import { Circle, CircleDashed, CircleOff, HelpCircle, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CurrentStatus, IntegrationScore } from '@/types/api'

// One component, color/icon driven entirely by a semantic prop — never ad
// hoc inline styling per usage site (PRD Section 6). The same "online"
// never looks different on two different pages.

type PillTone = 'online' | 'offline' | 'unknown' | 'neutral' | 'ai'

const TONE_STYLES: Record<PillTone, { text: string; bg: string }> = {
  online: { text: 'var(--color-status-online)', bg: 'var(--color-status-online-bg)' },
  offline: { text: 'var(--color-status-offline)', bg: 'var(--color-status-offline-bg)' },
  unknown: { text: 'var(--color-status-unknown)', bg: 'var(--color-status-unknown-bg)' },
  neutral: { text: 'var(--color-status-neutral)', bg: 'var(--color-status-neutral-bg)' },
  ai: { text: 'var(--color-status-ai)', bg: 'var(--color-status-ai-bg)' },
}

function Pill({
  tone,
  label,
  icon,
  className,
}: {
  tone: PillTone
  label: string
  icon?: React.ReactNode
  className?: string
}) {
  const style = TONE_STYLES[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-full)] px-2.5 py-1 text-xs font-medium',
        className,
      )}
      style={{ color: style.text, backgroundColor: style.bg }}
    >
      {icon}
      {label}
    </span>
  )
}

const CURRENT_STATUS_CONFIG: Record<CurrentStatus, { tone: PillTone; label: string; icon: React.ReactNode }> = {
  online: { tone: 'online', label: 'Online', icon: <Circle className="h-2.5 w-2.5 fill-current" /> },
  offline: { tone: 'offline', label: 'Offline', icon: <X className="h-3 w-3" /> },
  unknown: { tone: 'unknown', label: 'Unknown', icon: <CircleDashed className="h-3 w-3" /> },
}

export function CurrentStatusPill({ status, className }: { status: CurrentStatus; className?: string }) {
  const config = CURRENT_STATUS_CONFIG[status]
  return <Pill tone={config.tone} label={config.label} icon={config.icon} className={className} />
}

const INTEGRATION_SCORE_CONFIG: Record<IntegrationScore, { tone: PillTone; label: string }> = {
  easy: { tone: 'online', label: 'Easy' },
  medium: { tone: 'unknown', label: 'Medium' },
  hard: { tone: 'offline', label: 'Hard' },
  needs_verification: { tone: 'ai', label: 'Needs Verification' },
}

export function IntegrationScorePill({
  score,
  className,
}: {
  score: IntegrationScore
  className?: string
}) {
  const config = INTEGRATION_SCORE_CONFIG[score]
  const icon = score === 'needs_verification' ? <HelpCircle className="h-3 w-3" /> : undefined
  return <Pill tone={config.tone} label={config.label} icon={icon} className={className} />
}

export function ActiveStatusPill({ isActive, className }: { isActive: boolean; className?: string }) {
  return isActive ? (
    <Pill tone="online" label="Active" icon={<Circle className="h-2.5 w-2.5 fill-current" />} className={className} />
  ) : (
    <Pill tone="neutral" label="Inactive" icon={<CircleOff className="h-3 w-3" />} className={className} />
  )
}

export function AiAssistedBadge({ label = 'AI-Assisted', className }: { label?: string; className?: string }) {
  return <Pill tone="ai" label={label} icon={<Sparkles className="h-3 w-3" />} className={className} />
}

export function BetaBadge({ className }: { className?: string }) {
  return <Pill tone="ai" label="Beta" className={className} />
}
