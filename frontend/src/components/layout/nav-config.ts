import {
  Camera,
  LayoutDashboard,
  Map,
  ScrollText,
  Settings,
  ShieldCheck,
  Activity,
  Search,
} from 'lucide-react'
import type { AppRole } from '@/types/api'

export interface NavItem {
  label: string
  path: string
  icon: typeof LayoutDashboard
  /** Roles allowed to see this item at all — presence-gated, not just disabled (PRD 3.2). */
  roles: AppRole[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Overview',
    path: '/',
    icon: LayoutDashboard,
    roles: ['admin', 'field_officer', 'dept_viewer', 'auditor'],
  },
  {
    label: 'Cameras',
    path: '/cameras',
    icon: Camera,
    roles: ['admin', 'field_officer', 'dept_viewer', 'auditor'],
  },
  {
    label: 'Map',
    path: '/map',
    icon: Map,
    roles: ['admin', 'field_officer', 'dept_viewer'],
  },
  {
    label: 'Vehicle Search',
    path: '/vehicle-search',
    icon: Search,
    roles: ['admin', 'field_officer'],
  },
  {
    label: 'Scoring',
    path: '/scoring',
    icon: ShieldCheck,
    roles: ['admin', 'field_officer'],
  },
  {
    label: 'Health',
    path: '/health',
    icon: Activity,
    roles: ['admin', 'field_officer'],
  },
  {
    label: 'Audit Log',
    path: '/audit-log',
    icon: ScrollText,
    roles: ['admin', 'auditor'],
  },
]

// Rendered pinned to the bottom of the sidebar, above Collapse — not part of
// the main scrolling nav list — so it stays anchored regardless of how many
// role-visible items appear above it.
export const SETTINGS_NAV_ITEM: NavItem = {
  label: 'Settings',
  path: '/settings',
  icon: Settings,
  roles: ['admin', 'field_officer', 'dept_viewer', 'auditor'],
}
