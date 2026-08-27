import { Construction } from 'lucide-react'
import { EmptyState } from './EmptyState'

/**
 * Shared "not built yet, and here's specifically why" component — used
 * wherever a page or feature is blocked by a real backend gap tracked in
 * BACKEND_GAPS.md (project root). Never a silent no-op button, never a
 * console error, never fake data pretending the feature works — an honest,
 * on-brand explanation instead.
 */
export function ComingSoon({
  title = 'Coming soon',
  description,
  gapReference,
}: {
  title?: string
  description: string
  /** e.g. "BACKEND_GAPS.md #2" — shown as small muted text for engineers/admins reading this in dev. */
  gapReference?: string
}) {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <EmptyState
        icon={Construction}
        title={title}
        description={description}
        action={
          gapReference ? (
            <p className="font-mono text-xs text-[var(--text-secondary)]">{gapReference}</p>
          ) : undefined
        }
      />
    </div>
  )
}
