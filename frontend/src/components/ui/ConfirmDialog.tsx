import { Button } from './Button'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  isConfirming?: boolean
}

// Consistent copy pattern + button placement everywhere a destructive/
// consequential action needs confirming (PRD Section 6) — the destructive
// action is always the outline/secondary-styled button, never a loud
// filled-red one, reducing accidental confirms.
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  isConfirming,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-5 shadow-[var(--shadow-float)]">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} isLoading={isConfirming}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
