import { cn } from '@/lib/utils'

export interface SkeletonProps {
  /** 'bar' (default) for text/row placeholders, 'circle' for avatars/icons. */
  variant?: 'bar' | 'circle'
  /**
   * Which surface token to pulse against — 'surface' for a skeleton sitting
   * directly on the page background, 'raised' for one nested inside a card
   * (matches StatTile's existing nested-skeleton treatment).
   */
  surface?: 'surface' | 'raised'
  className?: string
}

// The one shared shimmer primitive — every page in this app was
// hand-rolling `<div className="h-N animate-pulse rounded-[var(--radius-md)]
// bg-[var(--bg-surface)]" />` locally (CameraListPage, AuditLogPage,
// ScoringQueuePage, CameraFormPage, HealthDashboardPage, StatTile). This
// replaces all of those with one import so every loading state stays
// visually identical by construction, not by copy-paste discipline.
export function Skeleton({ variant = 'bar', surface = 'surface', className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse',
        surface === 'surface' ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-surface-raised)]',
        variant === 'circle' ? 'rounded-full' : 'rounded-[var(--radius-md)]',
        className,
      )}
    />
  )
}

export interface SkeletonStackProps {
  /** How many repeated skeleton rows to render. */
  count: number
  /** Applied to every row — pass a height, e.g. "h-12". */
  rowClassName?: string
  /** Gap between rows, matching Tailwind's space-y-* scale. Default: 2. */
  gap?: 2 | 3 | 4
  surface?: SkeletonProps['surface']
  className?: string
}

// The "dynamically build a skeleton from a shape" piece: every page needs
// a different row count and row height, not a different component — this
// covers all of them with two props instead of five near-duplicate local
// TableSkeleton/FormSkeleton/... functions.
export function SkeletonStack({ count, rowClassName = 'h-12', gap = 2, surface, className }: SkeletonStackProps) {
  const gapClass = gap === 2 ? 'space-y-2' : gap === 3 ? 'space-y-3' : 'space-y-4'
  return (
    <div className={cn(gapClass, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} surface={surface} className={rowClassName} />
      ))}
    </div>
  )
}
