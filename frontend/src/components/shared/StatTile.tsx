import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'

interface StatTileProps {
  label: string
  value: string | number
  secondaryLine?: string
  icon?: LucideIcon
  accent?: 'default' | 'brand' | 'offline' | 'ai'
  onClick?: () => void
  isLoading?: boolean
  hasError?: boolean
}

const ACCENT_COLOR: Record<NonNullable<StatTileProps['accent']>, string> = {
  default: 'var(--text-primary)',
  brand: 'var(--color-brand)',
  offline: 'var(--color-status-offline)',
  ai: 'var(--color-status-ai)',
}

export function StatTile({
  label,
  value,
  secondaryLine,
  icon: Icon,
  accent = 'default',
  onClick,
  isLoading,
  hasError,
}: StatTileProps) {
  const isInteractive = typeof onClick === 'function'

  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 transition-colors duration-150',
        isInteractive && 'cursor-pointer hover:border-[var(--color-brand)]',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-[var(--text-secondary)]" /> : null}
      </div>

      {isLoading ? (
        <Skeleton surface="raised" className="mt-2 h-9 w-20 rounded" />
      ) : hasError ? (
        <p className="mt-2 text-sm text-[var(--color-status-offline)]">Couldn't load</p>
      ) : (
        <>
          <p
            className="mt-1 text-[32px] font-semibold leading-none tracking-tight"
            style={{ color: ACCENT_COLOR[accent] }}
          >
            {value}
          </p>
          {secondaryLine ? (
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{secondaryLine}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
