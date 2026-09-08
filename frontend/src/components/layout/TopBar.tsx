import { useEffect, useState } from 'react'
import { LogOut, Monitor, Moon, Search, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePageHeader } from '@/contexts/PageHeaderContext'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { CommandPalette } from './CommandPalette'
import { AlertBell } from './AlertBell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  field_officer: 'Field Officer',
  dept_viewer: 'Department Viewer',
  auditor: 'Auditor',
}

const INITIALS: Record<string, string> = {
  admin: 'AD',
  field_officer: 'FO',
  dept_viewer: 'DV',
  auditor: 'AU',
}

// Pixel-matched to the reference (Sentinel.dc.html): 56px header, a ⌘K
// search trigger, a "Synced" live-status dot, a visible dark/light segmented
// toggle (not buried in a menu), and a role pill. The old design only
// exposed theme switching inside the user dropdown — this surfaces it in
// the header itself, matching the reference exactly.
export function TopBar() {
  const { title } = usePageHeader()
  const { user, profile, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-[var(--border-default)] bg-[var(--bg-canvas)] px-6">
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h1>

        <div className="flex-1" />

        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden min-w-[190px] items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 text-[12.5px] text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-strong)] md:flex h-8">
          <Search className="h-[15px] w-[15px]" strokeWidth={1.9} />
          <span className="flex-1 text-left">Search or jump to…</span>
          <span className="rounded border border-[var(--border-default)] px-[5px] py-px font-mono text-[11px]">
            ⌘K
          </span>
        </button>

        <div title="Live sync" className="hidden items-center gap-[7px] pl-1 text-[12.5px] text-[var(--text-secondary)] sm:flex">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-status-online)] shadow-[0_0_0_3px_rgba(34,197,94,0.16)]" />
          Synced
        </div>

        <AlertBell />

        <div className="flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5">
          <button
            onClick={() => setTheme('dark')}
            title="Dark theme"
            className={`flex h-[26px] w-7 items-center justify-center rounded-md transition-colors duration-150 ${
              theme === 'dark' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
            }`}>
            <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            onClick={() => setTheme('light')}
            title="Light theme"
            className={`flex h-[26px] w-7 items-center justify-center rounded-md transition-colors duration-150 ${
              theme === 'light' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
            }`}>
            <Sun className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            onClick={() => setTheme('system')}
            title="Match system"
            className={`flex h-[26px] w-7 items-center justify-center rounded-md transition-colors duration-150 ${
              theme === 'system' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
            }`}>
            <Monitor className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <div className="flex items-center gap-[9px] rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] py-[3px] pl-[3px] pr-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[11px] font-semibold text-[var(--color-brand)]">
                {user ? INITIALS[user.role] : ''}
              </div>
              <span className="text-[12.5px] text-[var(--text-secondary)]">{user ? ROLE_LABEL[user.role] : ''}</span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{profile?.email ?? (user ? ROLE_LABEL[user.role] : '')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-[var(--color-status-offline)]">
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}
