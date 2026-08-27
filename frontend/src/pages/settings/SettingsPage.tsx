import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Users as UsersIcon } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useDepartments } from '@/hooks/useDepartments'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import { getApiErrorMessage, getApiErrorStatus } from '@/api/client'
import * as usersApi from '@/api/users'
import * as authApi from '@/api/auth'
import type { AppRole } from '@/types/api'

const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Administrator',
  field_officer: 'Field Officer',
  dept_viewer: 'Department Viewer',
  auditor: 'Auditor',
}

type SettingsTab = 'account' | 'users'

// Pixel-matched to the reference (Sentinel.dc.html) Settings screen: a
// 200px/1fr left-nav + content layout (Account / User management), each
// section rendered as a single bordered card with a header row. The
// reference's "User management" is a lookup-by-ID form because its mock
// backend only exposes PATCH /users/:id/role — our real backend also has
// GET /users, so we keep the real paginated table (strictly more capable)
// rather than downgrade to the mock's narrower form.
export function SettingsPage() {
  usePageTitle('Settings')
  const { user } = useAuth()
  const [tab, setTab] = useState<SettingsTab>('account')
  const canSeeUsers = user?.role === 'admin'

  return (
    <div className="grid max-w-[1000px] gap-6 p-6" style={{ gridTemplateColumns: '200px 1fr' }}>
      <div className="flex flex-col gap-0.5">
        <SettingsNavItem active={tab === 'account'} onClick={() => setTab('account')}>Account</SettingsNavItem>
        {canSeeUsers && (
          <SettingsNavItem active={tab === 'users'} onClick={() => setTab('users')}>User management</SettingsNavItem>
        )}
      </div>
      <div>{tab === 'account' ? <AccountSection /> : <UserManagementTable />}</div>
    </div>
  )
}

function SettingsNavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors duration-150',
        active ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
      )}>
      {children}
    </button>
  )
}

function AccountSection() {
  const { user, profile, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { data: departments = [] } = useDepartments()
  const departmentName = departments.find((d) => d.departmentId === user?.departmentId)?.name

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <div className="border-b border-[var(--border-default)] px-5 py-[18px] text-base font-semibold">Account</div>
        <div className="grid items-center gap-3.5 p-5 text-[13.5px]" style={{ gridTemplateColumns: '180px 1fr' }}>
          <p className="text-[var(--text-secondary)]">Email</p>
          <p className="font-mono text-[13px]">{profile?.email ?? '—'}</p>
          <p className="text-[var(--text-secondary)]">Role</p>
          <p>
            <span className="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-[3px] text-xs font-medium text-[var(--color-brand)]">
              {user ? ROLE_LABEL[user.role] : '—'}
            </span>
          </p>
          <p className="text-[var(--text-secondary)]">Department</p>
          <p>{departmentName ?? (user?.departmentId ? user.departmentId : 'All departments')}</p>
        </div>
        <div className="flex items-center gap-4 border-t border-[var(--border-default)] px-5 py-[18px]">
          <div className="flex-1">
            <p className="text-[13.5px] font-medium">Appearance</p>
            <p className="text-[12.5px] text-[var(--text-secondary)]">Dark is the default for control-room use.</p>
          </div>
          <div className="flex rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-[3px]">
            <button
              onClick={() => setTheme('dark')}
              className={cn('rounded-md px-3.5 py-1.5 text-[12.5px]', theme === 'dark' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              Dark
            </button>
            <button
              onClick={() => setTheme('light')}
              className={cn('rounded-md px-3.5 py-1.5 text-[12.5px]', theme === 'light' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              Light
            </button>
            <button
              onClick={() => setTheme('system')}
              className={cn('rounded-md px-3.5 py-1.5 text-[12.5px]', theme === 'system' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
              System
            </button>
          </div>
        </div>
        <div className="border-t border-[var(--border-default)] px-5 py-[18px]">
          <button
            onClick={() => logout()}
            className="inline-block rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-4 py-[9px] text-[13px] font-medium transition-colors duration-150 hover:border-[var(--border-strong)]">
            Sign out
          </button>
        </div>
      </div>

      <ChangePasswordSection />
    </div>
  )
}

// Authenticated Change Password (BACKEND_GAPS.md #7, closed) — current
// password required, no email involved. Email-based recovery for
// locked-out users is intentionally still deferred to a future phase.
function ChangePasswordSection() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordsMatch = newPassword === confirmPassword
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length > 0 && passwordsMatch

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!passwordsMatch) {
      setError("New password and confirmation don't match.")
      return
    }

    setIsSubmitting(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)

      // Changing the password revokes every refresh token, including this
      // session's — rather than let the access token silently fail 15
      // minutes from now, sign out immediately and explain why.
      await logout()
      navigate('/login', {
        replace: true,
        state: { message: 'Password changed — please sign in again.' },
      })
    } catch (err) {
      const status = getApiErrorStatus(err)
      setError(
        status === 401
          ? 'Current password is incorrect.'
          : getApiErrorMessage(err, 'Could not change your password.'),
      )
      setIsSubmitting(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-default)] px-5 py-[18px] text-base font-semibold">Change password</div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 p-5">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium">Current password</label>
          <Input
            type={showPasswords ? 'text' : 'password'}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium">New password</label>
          <Input
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium">Confirm new password</label>
          <Input
            type={showPasswords ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            hasError={confirmPassword.length > 0 && !passwordsMatch}
            required
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p className="mt-1 text-xs text-[var(--color-status-offline)]">Passwords don't match.</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowPasswords((s) => !s)}
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
        >
          {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPasswords ? 'Hide' : 'Show'} passwords
        </button>

        {error && <p className="text-sm text-[var(--color-status-offline)]">{error}</p>}

        <Button type="submit" size="sm" isLoading={isSubmitting} disabled={!canSubmit} className="self-start">
          Change password
        </Button>
      </form>
    </div>
  )
}

const PAGE_SIZE = 25

// Real user directory (BACKEND_GAPS.md #3, closed) — paginated table with
// inline role editing, same shape as CameraListPage's pagination pattern.
function UserManagementTable() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [rowState, setRowState] = useState<Record<string, { status: 'saving' | 'error'; message?: string }>>({})

  const { data: users, isLoading, isFetching } = useQuery({
    queryKey: ['users', page],
    queryFn: () => usersApi.listUsers({ page, limit: PAGE_SIZE }),
  })

  const handleRoleChange = async (userId: string, role: AppRole) => {
    setRowState((prev) => ({ ...prev, [userId]: { status: 'saving' } }))
    try {
      await usersApi.updateUserRole(userId, role)
      setRowState((prev) => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
      queryClient.setQueryData<usersApi.UserSummary[]>(['users', page], (prev) =>
        prev?.map((u) => (u.userId === userId ? { ...u, role } : u)),
      )
    } catch (err) {
      setRowState((prev) => ({
        ...prev,
        [userId]: { status: 'error', message: getApiErrorMessage(err, 'Could not update this user.') },
      }))
    }
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-default)] px-5 py-[18px]">
        <p className="text-base font-semibold">User management</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">Update a user's role. Changes apply immediately.</p>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Loading users…</div>
      ) : !users || users.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={UsersIcon} title="No users found" description="There are no user accounts to show on this page." />
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-default)] text-xs text-[var(--text-secondary)]">
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Department</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const state = rowState[u.userId]
              const isSelf = u.userId === currentUser?.userId
              return (
                <tr key={u.userId} className="border-b border-[var(--border-default)] last:border-0">
                  <td className="px-5 py-3">{u.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Select
                        value={u.role}
                        disabled={state?.status === 'saving' || isSelf}
                        onChange={(e) => handleRoleChange(u.userId, e.target.value as AppRole)}
                        className="w-auto"
                      >
                        <option value="admin">Administrator</option>
                        <option value="field_officer">Field Officer</option>
                        <option value="dept_viewer">Department Viewer</option>
                        <option value="auditor">Auditor</option>
                      </Select>
                      {state?.status === 'saving' && <span className="text-xs text-[var(--text-secondary)]">Saving…</span>}
                    </div>
                    {isSelf && <p className="mt-1 text-xs text-[var(--text-secondary)]">You can't change your own role.</p>}
                    {state?.status === 'error' && <p className="mt-1 text-xs text-[var(--color-status-offline)]">{state.message}</p>}
                  </td>
                  <td className="px-5 py-3 text-[var(--text-secondary)]">{u.departmentId ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border-default)] px-5 py-3">
        <p className="text-xs text-[var(--text-secondary)]">Page {page}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching || !users || users.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
