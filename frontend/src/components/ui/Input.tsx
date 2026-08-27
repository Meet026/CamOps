import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, hasError, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          hasError ? 'border-[var(--color-status-offline)]' : 'border-[var(--border-default)]',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'
