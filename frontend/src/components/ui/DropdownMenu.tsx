import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DropdownContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}

const DropdownContext = createContext<DropdownContextValue | null>(null)

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <DropdownContext.Provider value={{ isOpen, setIsOpen }}>
      <div ref={ref} className="relative inline-block">
        {children}
      </div>
    </DropdownContext.Provider>
  )
}

function useDropdown() {
  const ctx = useContext(DropdownContext)
  if (!ctx) throw new Error('Dropdown parts must be used within DropdownMenu')
  return ctx
}

export function DropdownMenuTrigger({ children }: { children: ReactNode }) {
  const { isOpen, setIsOpen } = useDropdown()
  return (
    <button type="button" onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen}>
      {children}
    </button>
  )
}

export function DropdownMenuContent({
  children,
  align = 'end',
}: {
  children: ReactNode
  align?: 'start' | 'end'
}) {
  const { isOpen } = useDropdown()
  if (!isOpen) return null

  return (
    <div
      className={cn(
        'absolute top-full z-50 mt-2 min-w-[200px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-float)]',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        align === 'end' ? 'right-0' : 'left-0',
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuItem({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  const { setIsOpen } = useDropdown()
  return (
    <button
      type="button"
      onClick={() => {
        onClick?.()
        setIsOpen(false)
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm text-[var(--text-primary)] transition-colors duration-100 hover:bg-[var(--bg-canvas)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-[var(--border-default)]" />
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)]">{children}</div>
}
