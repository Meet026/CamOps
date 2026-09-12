import { Bell } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as notificationsApi from '@/api/notifications'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'

const POLL_INTERVAL_MS = 20_000

function formatRelativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Polling, not a websocket — matches this codebase's existing pattern for
// near-live data (e.g. Live Stream's active-count badge), and needs no new
// server infrastructure. 20s keeps a wanted-list match from sitting unseen
// for long without polling aggressively enough to matter for load.
export function NotificationBell() {
  const queryClient = useQueryClient()

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: POLL_INTERVAL_MS,
  })

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.listNotifications({ limit: 20 }),
    refetchInterval: POLL_INTERVAL_MS,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllNotificationsRead()
    invalidate()
  }

  const handleOpenNotification = async (notificationId: string, isRead: boolean) => {
    if (!isRead) {
      await notificationsApi.markNotificationRead(notificationId)
      invalidate()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <div
          title="Notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors duration-150 hover:text-[var(--text-primary)]"
        >
          <Bell className="h-[15px] w-[15px]" strokeWidth={1.9} />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--color-status-offline)] px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="w-[340px] max-w-[90vw]">
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-[var(--color-brand)] hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="my-1 h-px bg-[var(--border-default)]" />

          {notifications.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-[var(--text-secondary)]">
              No notifications yet.
            </p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              {notifications.map((n) => (
                <button
                  key={n.notificationId}
                  type="button"
                  onClick={() => handleOpenNotification(n.notificationId, n.isRead)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors duration-100 hover:bg-[var(--bg-canvas)]',
                    !n.isRead && 'bg-[var(--color-brand-soft)]',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-status-offline)]" />
                    <span className="text-[13px] font-medium">Wanted list match — {n.plateNumber}</span>
                  </div>
                  <p className="pl-3 text-xs text-[var(--text-secondary)]">
                    {n.personName} · {n.crimeDetails}
                  </p>
                  <p className="pl-3 text-[11px] text-[var(--text-secondary)]">
                    {formatRelativeTime(n.createdAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
