import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { NAV_ITEMS } from './nav-config'

// Mobile gets the most-used 5 items only — Audit Log and Settings live one
// tap further via the "More" pattern is unnecessary here since Settings is
// reachable from the top bar's avatar menu on every breakpoint.
const MOBILE_PRIORITY_PATHS = ['/', '/cameras', '/map', '/scoring', '/health']

export function MobileTabBar() {
  const { user } = useAuth()
  if (!user) return null

  const items = NAV_ITEMS.filter(
    (item) => item.roles.includes(user.role) && MOBILE_PRIORITY_PATHS.includes(item.path),
  )

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-[var(--border-default)] bg-[var(--bg-surface)] md:hidden">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            cn(
              'flex flex-col items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition-colors duration-150',
              isActive ? 'text-[var(--color-brand)]' : 'text-[var(--text-secondary)]',
            )
          }
        >
          <item.icon className="h-5 w-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
