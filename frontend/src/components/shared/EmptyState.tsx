import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  tone?: 'default' | 'positive'
  className?: string
}

// One component, many configurations — every empty state in the product
// (dashboard, list, queue, at-risk) is an instance of this pattern
// (PRD Section 6), which is why they all feel coherent.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] px-6 py-16 text-center',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full',
          tone === 'positive'
            ? 'bg-[var(--color-status-online-bg)] text-[var(--color-status-online)]'
            : 'bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]',
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        {description ? <p className="max-w-sm text-sm text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
